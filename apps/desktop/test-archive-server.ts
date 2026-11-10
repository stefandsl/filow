// A local HTTP server for the model download tests (stt-resume.test.ts, tts.test.ts): it serves one
// real .tar.bz2, built from random files so bzip2 cannot shrink it, with Range support, and it can
// misbehave on purpose. Each test reads what it saw (requests, Range headers) and resets it.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

export type ArchiveMode =
  /** Honours "Range: bytes=N-" (206, or 416 past the end of the file). */
  | "range"
  /** Always sends the whole file with 200, as a server without Range support does. */
  | "ignore-range"
  /** The first request gets half the file, then the connection is cut like a dropped Wi-Fi. */
  | "drop-first"
  /** The next request waits until release(); later requests are served as in "range". */
  | "hold-next";

export type ArchiveServer = {
  bytes: Buffer;
  sha256: string;
  base: string;
  mode: ArchiveMode;
  requests: number;
  seenRanges: string[];
  /** True while a "hold-next" request is waiting. */
  held(): boolean;
  /** Answers the waiting "hold-next" request. */
  release(): void;
  /** Back to `mode` (default "range") with no requests seen. */
  reset(mode?: ArchiveMode): void;
  close(): Promise<void>;
};

/** Builds <root>/fixture.tar.bz2 holding <archive>/<files> (random bytes, `fileSize` each) and serves it. */
export async function startArchiveServer(root: string, archive: string, files: string[], fileSize: number): Promise<ArchiveServer> {
  const src = path.join(root, "src", archive);
  fs.mkdirSync(src, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(src, f), crypto.randomBytes(fileSize));
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
  const out = path.join(root, "fixture.tar.bz2");
  execFileSync(tar, ["-cjf", out, "-C", path.join(root, "src"), archive]);
  const bytes = fs.readFileSync(out);
  let waiting: (() => void) | null = null;

  const s: ArchiveServer = {
    bytes,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    base: "",
    mode: "range",
    requests: 0,
    seenRanges: [],
    held: () => waiting !== null,
    release() {
      const send = waiting;
      waiting = null;
      send?.();
    },
    reset(mode = "range") {
      s.mode = mode;
      s.requests = 0;
      s.seenRanges = [];
    },
    close: () =>
      new Promise<void>((r) => {
        waiting = null;
        server.closeAllConnections();
        server.close(() => r());
      }),
  };

  const server = http.createServer((req, res) => {
    s.requests++;
    const range = req.headers.range;
    if (range) s.seenRanges.push(range);
    const m = /^bytes=(\d+)-$/.exec(range || "");
    const send = () => {
      if (m && s.mode !== "ignore-range") {
        const start = Number(m[1]);
        if (start >= bytes.length) {
          res.writeHead(416, { "Content-Range": `bytes */${bytes.length}` });
          return void res.end();
        }
        res.writeHead(206, { "Content-Length": bytes.length - start, "Content-Range": `bytes ${start}-${bytes.length - 1}/${bytes.length}` });
        return void res.end(bytes.subarray(start));
      }
      res.writeHead(200, { "Content-Length": bytes.length });
      if (s.mode === "drop-first" && s.requests === 1) {
        // Half, then the cut. Bytes still in the client's write buffer at that instant are lost
        // (at most a few KB); what reached disk stays.
        return void res.write(bytes.subarray(0, Math.floor(bytes.length / 2)), () => setTimeout(() => res.destroy(), 300));
      }
      res.end(bytes);
    };
    if (s.mode === "hold-next") {
      s.mode = "range";
      waiting = send;
    } else send();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  s.base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return s;
}
