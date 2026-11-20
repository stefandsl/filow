// UI part of the N-02 Windows replay. The operator launches the private package and the isolated
// LAN peer under the egress observer, with a synthetic two-section script on the prompter.
// Forward the peer browser's DevTools port to loopback, with one fresh about:blank tab.
// Run once per profile/binary combination. Use the package manifest with archive, sha512,
// sourceSha and destination (the folder containing win-unpacked). Supply a NEW evidence directory.
// node tools/autoloop/e2e/n02-windows.mjs --package G:/run/package.json --profile-origin fresh
//   --out G:/run/evidence/s1-fresh --app-port 5101 --relay-port 5102 --debug-port 9601
//   --peer-port 9602 --lan-ip 192.168.1.20
// The UI result supplements the operator's launch, egress, fixture, profile and restart receipts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { isIPv4 } from "node:net";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { parseArgs } from "node:util";
import { connect, sleep } from "../../whiteboard/qa-dev.mjs";

async function until(read, description) {
  const deadline = Date.now() + 30_000;
  do {
    const value = await read();
    if (value) return value;
    await sleep(200);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for " + description);
}

function projectVolume(input) {
  const full = path.resolve(input);
  assert(/^G:\\/i.test(full) && !/^G:\\FILOW(?:\\|$)/i.test(full), "Use a private directory on G:");
  return full;
}

async function attach(port, match) {
  const list = await fetch("http://127.0.0.1:" + port + "/json/list", { signal: AbortSignal.timeout(5000) });
  assert(list.ok, "DevTools endpoint is unavailable");
  const pages = (await list.json()).filter(page => page.type === "page" && match(page.url));
  assert.equal(pages.length, 1, "Expected exactly one matching page");
  const address = new URL(pages[0].webSocketDebuggerUrl);
  assert.equal(address.origin, "ws://127.0.0.1:" + port);
  return connect(pages[0]);
}

async function screenshot(page, dir, name) {
  const message = await page.call("Page.captureScreenshot", { format: "png" });
  assert(message.result?.data, "Screenshot unavailable");
  fs.writeFileSync(path.join(dir, name), Buffer.from(message.result.data, "base64"), { flag: "wx" });
}

async function click(page, selector) {
  const point = await page.evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button || button.disabled) return null;
    button.scrollIntoView({ block: "nearest" });
    const box = button.getBoundingClientRect();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    return button.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
  })()`);
  assert(point, "Expected a visible, enabled control: " + selector);
  for (const type of ["mousePressed", "mouseReleased"]) {
    const message = await page.call("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
    assert(!message.error, "Input event failed");
  }
}

function windowOwner(ports, destination) {
  const query = [
    "$ErrorActionPreference='Stop'",
    "$ports=$env:N02_PORTS.Split(',') | ForEach-Object { [int]$_ }",
    "$listeners=@(Get-NetTCPConnection -State Listen -LocalPort $ports)",
    "if (@($listeners.LocalPort | Sort-Object -Unique).Count -ne $ports.Count) { throw 'missing port' }",
    "$owners=@($listeners.OwningProcess | Sort-Object -Unique)",
    "if ($owners.Count -ne 1) { throw 'unexpected port owner' }",
    "$app=Get-Process -Id $owners[0]",
    "[pscustomobject]@{ pid=$app.Id; exe=$app.Path; hwnd=$app.MainWindowHandle.ToInt64() } | ConvertTo-Json -Compress",
  ].join("\n");
  const owner = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", query],
    { encoding: "utf8", timeout: 30_000, windowsHide: true, env: { ...process.env, N02_PORTS: ports.join(",") } }));
  const exe = path.join(destination, "win-unpacked", "Filow.exe");
  assert.equal(fs.realpathSync.native(owner.exe).toLowerCase(), fs.realpathSync.native(exe).toLowerCase());
  assert(owner.hwnd > 0, "Private package needs a visible main window");
  return owner;
}

async function lanTrial(desktop, peer, dir, lanOrigin, relayOrigin) {
  const section = "document.querySelector('.section-nav-list [aria-current=true]')?.title";
  const heading = "document.querySelector('h1.section-title')?.textContent";
  const controls = ".topbar button.chip.code";
  const readStatus = () => desktop.evaluate("window.filow.remoteStatus()");
  const local = async () => {
    const status = await readStatus();
    assert.equal(status.state, "off");
    assert.equal(status.wanted, false);
    assert.equal(status.url, "");
    assert.equal(status.session, "");
  };
  await until(() => desktop.evaluate("document.visibilityState === 'visible' && document.querySelector('.topbar button.chip.code') && " + section), "hydrated prompter");
  // Also cover a former delayed startup check. The observer must already be recording at launch.
  await sleep(9000);
  await local();
  const first = await desktop.evaluate(section);
  await click(desktop, controls);
  const dialog = ".pairmodal[role=dialog]";
  const code = await until(() => desktop.evaluate("document.querySelector('.pairmodal .bigcode')?.textContent?.trim()"), "visible pairing code");
  const hint = await desktop.evaluate("document.querySelector('.pairmodal .hint:has(+ .chip)')?.textContent");
  const link = new URL(hint?.match(/https?:\/\/[^\s]+/)?.[0]?.replace(/[.,]$/, "") || "");
  assert.equal(link.origin, lanOrigin);
  assert.equal(link.pathname, "/mirror");
  assert.equal(link.searchParams.get("code"), code);
  assert.equal(link.searchParams.get("server"), relayOrigin);
  await local();
  await screenshot(desktop, dir, "pairing.png");

  const navigation = await peer.call("Page.navigate", { url: link.href });
  assert(!navigation.error && !navigation.result?.errorText, "Peer could not open the LAN mirror");
  await until(() => peer.evaluate("(" + heading + ") === " + JSON.stringify(first)), "first section on the LAN peer");
  await screenshot(peer, dir, "peer-before.png");
  const rotated = await until(() => desktop.evaluate("document.querySelector('.pairmodal .bigcode')?.textContent?.trim() !== " + JSON.stringify(code) + " && document.querySelector('.pairmodal .bigcode')?.textContent?.trim()"), "replacement pairing code");
  assert(rotated !== code);
  await click(desktop, dialog + " > button:last-child");
  const next = await desktop.evaluate("document.querySelector('.section-link[aria-current=true] + .section-link')?.title");
  assert(next && next !== first, "Use a synthetic script with two distinct consecutive section titles");
  await click(peer, ".stage button.next-jump");
  await until(() => desktop.evaluate("(" + section + ") === " + JSON.stringify(next)), "next section on the desktop");
  await until(() => peer.evaluate("(" + heading + ") === " + JSON.stringify(next)), "next section on the LAN peer");
  await screenshot(peer, dir, "peer-after.png");
  await local();
  await peer.call("Page.reload", { ignoreCache: true });
  await until(() => peer.evaluate("document.querySelector('.pair .chip.err')?.textContent?.includes('unknown code')"), "spent code rejected by the mirror");
  await screenshot(peer, dir, "spent-code.png");
  return { firstSlideMatched: true, nextSlideMatched: true, spentCodeRejected: true };
}

// Use an English synthetic profile for this replay. The native dialog must belong to this launch.
function answerSharingNotice(pid, grant) {
  const script = `
    $ErrorActionPreference='Stop'
    Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
    $root=[Windows.Automation.AutomationElement]::RootElement
    $condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,[int]$env:N02_PID)
    $end=[DateTime]::UtcNow.AddSeconds(10)
    do {
      foreach ($win in $root.FindAll([Windows.Automation.TreeScope]::Children,$condition)) {
        if ($win.Current.Name -ne 'Share to a phone on another network') {continue}
        $all=$win.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
        $words=($all | ForEach-Object {$_.Current.Name}) -join ' '
        foreach ($word in @('Cloudflare','Anyone','script','transcript','slide','approve','Turn off')) {
          if (!$words.Contains($word)) {throw 'Incomplete public-link disclosure'}
        }
        foreach ($el in $all) {
          if ($el.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and $el.Current.Name -eq $env:N02_CHOICE) {
            $el.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
            return
          }
        }
      }
      Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $end)
    throw 'Owned sharing dialog or button missing'
  `;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 20000,
    env: { ...process.env, N02_PID: String(pid), N02_CHOICE: grant ? grant : "Cancel" } });
}

async function portClosed(port) {
  return new Promise(resolve => {
    const socket = net.connect(port, "127.0.0.1");
    socket.setTimeout(1000);
    socket.on("connect", () => { socket.destroy(); resolve(false); });
    socket.on("error", e => resolve(e.code === "ECONNREFUSED"));
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
  });
}

async function publicTrial(desktop, owner, fixture, dir, appPort, relayPort) {
  const ports = JSON.parse(fs.readFileSync(path.join(fixture, "ports.json"), "utf8"));
  assert.deepEqual(ports.slice(0, 2), [appPort, relayPort]);
  const [web, relay] = ports.slice(2);
  const status = () => desktop.evaluate("window.filow.remoteStatus()");
  const state = expected => until(async () => (await status()).state === expected, "public link " + expected);
  const button = ".pairmodal[role=dialog] > .hint > button.btn";
  const signal = async grant => {
    const label = await desktop.evaluate("document.querySelector(" + JSON.stringify(button) + ").textContent.trim()");
    await click(desktop, button);
    answerSharingNotice(owner.pid, grant && label);
  };
  const closed = () => until(async () => (await portClosed(web)) && (await portClosed(relay)), "both fixture transports closed");
  await closed();
  await click(desktop, ".topbar button.chip.code");
  await signal(false);
  await state("off");
  for (const role of ["web", "relay"]) assert(!fs.existsSync(path.join(fixture, role + ".jsonl")), "Decline launched a helper");
  const hold = path.join(fixture, "hold");
  fs.writeFileSync(hold, "", { flag: "wx" });
  try {
    await signal(true);
    await state("connecting");
    await until(() => ["web", "relay"].every(role => fs.existsSync(path.join(fixture, role + ".jsonl"))), "two connecting children");
    await click(desktop, button);
    await state("off");
    await closed();
  } finally { fs.unlinkSync(hold); }
  await signal(true);
  await state("on");
  const current = await status();
  assert.equal(current.url, "https://n02-web.trycloudflare.com");
  assert.equal(current.session, "https://n02-relay.trycloudflare.com");
  await screenshot(desktop, dir, "public-active.png");
  // Map only these verified labels onto the two local fixture listeners. No public DNS or TLS.
  const code = await desktop.evaluate("document.querySelector('.pairmodal .bigcode').textContent.trim()");
  const response = await fetch("http://127.0.0.1:" + web + "/mirror?code=" + encodeURIComponent(code), { redirect: "error" });
  assert(response.ok && (await response.text()).includes("Filow"));
  const origin = "http://127.0.0.1:" + relay;
  const paired = await fetch(origin + "/api/session/pair", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, device: "N02 fixture phone" }), redirect: "error" });
  assert(paired.ok);
  const { id, role, viewToken } = await paired.json();
  assert.equal(role, "pending");
  const socket = new WebSocket("ws://127.0.0.1:" + relay + "/ws/session/" + encodeURIComponent(id));
  const messages = [];
  let disconnected = false;
  socket.addEventListener("close", () => { disconnected = true; });
  socket.addEventListener("open", () => socket.send(JSON.stringify({ t: "hello", role: "viewer", token: viewToken })));
  socket.addEventListener("message", e => messages.push(JSON.parse(e.data).t));
  try {
    await until(() => messages.includes("welcome"), "pending phone");
    await until(() => desktop.evaluate("document.querySelector('.pairmodal .strip')?.textContent.includes('N02 fixture phone')"), "approval request");
    await screenshot(desktop, dir, "pending-phone.png");
    assert(!messages.some(t => t === "state" || t === "patch"));
    await click(desktop, ".pairmodal .strip .controls button:nth-child(2)");
    await until(() => messages.includes("state"), "approved mirror state");
    await click(desktop, button);
    await state("off");
    await closed();
    await until(() => disconnected, "closed public socket");
    await click(desktop, ".pairmodal[role=dialog] > button:last-child");
  } finally { socket.close(); }
  return { localWebReceived: true, pendingWithheldState: true, approvedStateReceived: true, revokedSocketClosed: true,
    fixtureEvents: ["web", "relay"].map(role => fs.readFileSync(path.join(fixture, role + ".jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line))) };
}

async function main() {
  assert.equal(process.platform, "win32");
  const names = ["package", "profile-origin", "out", "app-port", "relay-port", "debug-port", "peer-port", "lan-ip"];
  const { values } = parseArgs({ options: Object.fromEntries([...names, "fixture-dir"].map(key => [key, { type: "string" }])) });
  for (const key of names) assert(values[key], "Missing --" + key);
  const ports = ["app-port", "relay-port", "debug-port", "peer-port"].map(key => Number(values[key]));
  assert(ports.every(p => Number.isInteger(p) && p > 1023 && p <= 65535 && ![4747, 4748, 11434].includes(p)));
  assert.equal(new Set(ports).size, ports.length);
  const [app, relay, debug, peerPort] = ports;
  const ip = values["lan-ip"];
  assert(isIPv4(ip) && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip), "Expected private LAN IPv4");
  const manifest = JSON.parse(fs.readFileSync(projectVolume(values.package), "utf8"));
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.match(sha, /^[\da-f]{40}$/);
  assert.equal(manifest.sourceSha, sha);
  const digest = createHash("sha512");
  for await (const chunk of fs.createReadStream(projectVolume(manifest.archive))) digest.update(chunk);
  const packageSha512 = digest.digest("hex");
  assert.equal(packageSha512, manifest.sha512.toLowerCase());
  const owner = windowOwner([app, relay, debug], projectVolume(manifest.destination));
  const dir = projectVolume(values.out);
  fs.mkdirSync(dir);
  const fixture = values["fixture-dir"] && projectVolume(values["fixture-dir"]);
  const record = { item: fixture ? 2 : 1, mode: fixture ? "Loopback public-link fixture and LAN peer" : "LAN mirror UI", profileOrigin: values["profile-origin"], sha, packageSha512,
    device: os.hostname(), os: os.version(), owner, ports, command: process.argv, cwd: process.cwd(), start: new Date().toISOString(),
    expected: fixture ? "Decline, cancel connecting, approve a remote phone, receive state, revoke both transports and advance a slide on LAN" : "Local pairing, synchronized slide advance and rejection of the spent code" };
  let desktop, peer;
  try {
    desktop = await attach(debug, url => url === "http://127.0.0.1:" + app + "/" || url === "http://127.0.0.1:" + app);
    peer = await attach(peerPort, url => url === "about:blank");
    if (fixture) record.publicLink = await publicTrial(desktop, owner, fixture, dir, app, relay);
    record.observed = await lanTrial(desktop, peer, dir, "http://" + ip + ":" + app, "http://" + ip + ":" + relay);
    record.exit = 0;
  } catch (err) {
    record.exit = 1;
    // Assertion values may contain a usable pairing link. Keep only the failing call site.
    record.failureSite = String(err.stack).split("\n").find(line => line.includes("n02-windows.mjs:"))?.trim();
    throw new Error("LAN UI replay failed. See the private evidence directory.");
  } finally {
    peer?.close();
    desktop?.close();
    record.end = new Date().toISOString();
    record.evidence = fs.readdirSync(dir);
    fs.writeFileSync(path.join(dir, "ui.json"), JSON.stringify(record, null, 2), { flag: "wx" });
  }
}

await main();
