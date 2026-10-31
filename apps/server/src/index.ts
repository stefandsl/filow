// Entry point: `node dist/index.js` (systemd, Electron) or `tsx src/index.ts` (dev).
import { createSessionServer } from "./server";

const port = Number(process.env.SESSION_PORT || 4748);
const host = process.env.SESSION_HOST || "127.0.0.1";
const server = createSessionServer({
  accessPassword: process.env.ACCESS_PASSWORD || undefined,
  secret: process.env.SESSION_SECRET || undefined,
});
server.httpServer.listen(port, host, () => {
  console.log(`[session] listening on http://${host}:${port}${process.env.ACCESS_PASSWORD ? " (password required)" : ""}`);
});

export { server };
