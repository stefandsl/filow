// UI part of the N-02 Windows replay. The operator launches the private package and the isolated
// LAN peer under the egress observer, with a synthetic two-section script on the prompter.
// Forward the peer browser's DevTools port to loopback, with one fresh about:blank tab.
// Run once per profile/binary combination. Use the package manifest with archive, sha512,
// sourceSha and destination (the folder containing win-unpacked). Supply a NEW evidence directory.
// node tools/autoloop/e2e/n02-windows.mjs --package ../run/package.json --profile-origin fresh
//   --out ../run/evidence/s1-fresh --app-port 5101 --relay-port 5102 --debug-port 9601
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
import { openRouterFixture, replayPath } from "./n02-fixtures.mjs";

async function until(read, description) {
  const deadline = Date.now() + 30_000;
  do {
    const value = await read();
    if (value) return value;
    await sleep(200);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for " + description);
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

// With --practice-input local|typed|voice, start from the tour, or use --entry prompter
// after skipping it. --entry welcome exercises the first-screen shortcut. Use a private local
// model or a separately approved loopback receiver. For voice, play the synthetic question through
// the selected capture device or the QA build's fake microphone. Keep the app normally visible.
async function practiceTrial(debug, origin, dir, input, entry, router, failure, retryLocal) {
  const at = pathname => url => url.startsWith(origin + "/") && new URL(url).pathname === pathname;
  const pageAt = async match => {
    await until(async () => {
      const res = await fetch("http://127.0.0.1:" + debug + "/json/list");
      return (await res.json()).some(p => p.type === "page" && match(p.url));
    }, "practice window");
    return attach(debug, match);
  };
  const started = Date.now();
  if (entry !== "tour") {
    const welcome = entry === "welcome";
    const first = await pageAt(welcome ? url => url.startsWith("file:") && url.endsWith("/welcome.html") : at("/"));
    try {
      const control = welcome ? "#first-task" : "a[href='/tour']";
      await until(() => first.evaluate("document.visibilityState === 'visible' && document.querySelector(" + JSON.stringify(control) + ")?.clientWidth"), "visible first-use entry");
      await screenshot(first, dir, "entry.png");
      await click(first, control);
    } finally { first.close(); }
  }
  const tour = await pageAt(at("/tour"));
  let panel;
  try {
    await until(() => tour.evaluate("document.visibilityState === 'visible' && document.querySelector('.tour-actions .primary')?.clientWidth"), "hydrated tour");
    const entryMs = Date.now() - started;
    const target = await tour.evaluate("document.querySelector('.tour-paper button').textContent.trim()");
    const italian = target === "Salva prova";
    assert(italian || target === "Save practice", "Use the EN or IT test profile");
    const question = italian ? "Dove si trova Salva prova?" : "Where is Save practice?";
    await screenshot(tour, dir, "task.png");
    if (input === "local") {
      await click(tour, ".tour-actions button:nth-child(2)");
      await until(() => tour.evaluate("document.querySelector('.tour-status').textContent === document.querySelector('.tour-preview-note').textContent"), "local practice mark");
    } else {
      await click(tour, ".tour-actions .primary");
      panel = await pageAt(at("/okfilow/panel"));
      await until(() => panel.evaluate("document.visibilityState === 'visible' && document.querySelector('.okf-type input') === document.activeElement"), "focused question box");
      if (router) {
        // Change the provider using the panel's own control. A configured key alone grants nothing.
        const select = "select:has(option[value=cloud]):has(option[value=freellm])";
        assert.equal(await panel.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(select)});
          if (!el || el.disabled) return false;
          el.value = 'cloud'; el.dispatchEvent(new Event('change', { bubbles: true })); return true;
        })()`), true);
        await until(() => panel.evaluate("document.querySelector(" + JSON.stringify(select) + ").value === 'cloud'"), "cloud selected");
        const eye = ".okf-see-switch";
        if (await panel.evaluate("document.querySelector('.okf-see-switch')?.getAttribute('aria-checked') === 'true'")) await click(panel, eye);
        await until(() => panel.evaluate("document.querySelector('.okf-see-switch')?.getAttribute('aria-checked') === 'false'"), "words only");
        await click(panel, ".okf-type input");
      }
      if (input === "typed") {
        if (failure === "denied") {
          await click(panel, "[data-testid=start-mic]");
          await until(() => panel.evaluate("document.querySelector('[data-recovery=mic]') && !document.querySelector('[data-testid=stop-mic]')"), "denied microphone and stopped capture");
          await screenshot(panel, dir, "mic-denied.png");
          await click(panel, "[data-recovery=mic] button");
          assert(await panel.evaluate("document.activeElement.matches('.okf-type input')"));
        }
        await panel.call("Input.insertText", { text: question });
        await panel.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await panel.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      } else {
        await panel.evaluate(`(() => {
          const devices = navigator.mediaDevices, original = devices.getUserMedia.bind(devices);
          devices.getUserMedia = async constraints => {
            const stream = await original(constraints);
            window.n02Track = stream.getAudioTracks()[0];
            devices.getUserMedia = original;
            return stream;
          };
        })()`);
        await click(panel, "[data-testid=start-mic]");
        await until(() => panel.evaluate("window.n02Track?.readyState === 'live' && document.querySelector('[data-testid=send-spoken]')"), "live capture");
        await screenshot(panel, dir, "live-microphone.png");
        await sleep(4500);
        await click(panel, "[data-testid=send-spoken]");
        await until(() => panel.evaluate("window.n02Track.readyState === 'ended'"), "closed capture");
      }
      if (router) {
        const notice = await until(() => panel.evaluate("document.visibilityState === 'visible' && document.querySelector('.okf-notice[role=alertdialog]')?.innerText"), "visible outbound notice");
        for (const recipient of ["OpenRouter", "OpenAI"]) assert(notice.includes(recipient));
        assert(/no picture|nessuna immagine/i.test(notice));
        assert.equal(router.requests.length, 0);
        await screenshot(panel, dir, "cloud-notice.png");
        await click(panel, ".okf-notice-send");
        if (failure !== "missing") {
        await until(() => router.waiting(), "provider received question");
        if (await panel.evaluate("document.visibilityState !== 'visible'")) await click(tour, ".tour-actions .primary");
        const pill = await until(() => panel.evaluate("document.visibilityState === 'visible' && document.querySelector('.okf-out-to')?.innerText"), "visible sending indicator");
        assert(pill.includes("OpenRouter") && pill.includes("OpenAI"));
        await screenshot(panel, dir, "sending.png");
        const [r] = router.requests;
        assert.equal(router.requests.length, 1);
        assert(r.maker === "openai" && r.hosts?.length === 1 && r.hosts[0] === "openai" && r.wordsOnly && r.questionMatched && r.privateOriginAbsent);
        r.indicatorObserved = new Date().toISOString();
        router.release(({ quota: 402, rate: 429, outage: 503 })[failure] || 200);
        }
      }
      const providerFailed = failure && failure !== "denied";
      if (providerFailed) {
        const reason = ({ missing: "setup", quota: "quota", rate: "quota", outage: "outage" })[failure];
        await until(() => panel.evaluate("document.querySelector('[data-recovery=" + reason + "]') && !document.querySelector('.okf-out-to')"), "distinct failure and stopped sending");
        if (await panel.evaluate("document.visibilityState !== 'visible'")) await click(tour, ".tour-actions .primary");
        await screenshot(panel, dir, "private-recovery.png");
        if (retryLocal) {
          await click(panel, "[data-recovery] button:nth-last-child(2)");
          await until(() => panel.evaluate("document.activeElement.matches('.okf-type input')"), "local provider selection");
          await panel.call("Input.insertText", { text: question });
          await click(panel, ".okf-type button[type=submit]");
        } else {
          await click(panel, "[data-recovery] button:last-child");
          await click(tour, ".tour-actions button:nth-child(2)");
          await until(() => tour.evaluate("document.querySelector('.tour-status').textContent === document.querySelector('.tour-preview-note').textContent"), "model-free recovery");
        }
      }
      if (!providerFailed || retryLocal) {
      const answerMatch = (!providerFailed && router?.marker) || target.toLowerCase();
      await until(() => panel.evaluate("document.querySelector('.okf-a')?.textContent.toLowerCase().includes(" + JSON.stringify(answerMatch) + ")"), "assistant answer identifying the practice target");
      if (await panel.evaluate("document.visibilityState !== 'visible'")) await click(tour, ".tour-actions .primary");
      await until(() => panel.evaluate("document.visibilityState === 'visible' && document.querySelector('.okf-a')?.clientWidth"), "visible answer");
      await screenshot(panel, dir, "answer.png");
      await click(panel, ".okf-x");
      }
      if (router) assert.equal(router.requests.length, failure === "missing" ? 0 : 1);
    }
    const before = await tour.evaluate("document.querySelector('.tour-status').textContent");
    await click(tour, ".tour-paper button");
    await until(() => tour.evaluate("document.querySelector('.tour-status').textContent !== " + JSON.stringify(before)), "practice completion");
    await screenshot(tour, dir, "completed.png");
    return { entry, input, failure, retryLocal, entryMs, resultMs: Date.now() - started, completed: true,
      consentPrompts: router ? 1 : undefined, consentChoice: router ? "grant words only" : undefined,
      assistantAnswerObserved: input !== "local" && (!failure || failure === "denied" || retryLocal) };
  } finally { panel?.close(); tour.close(); }
}

async function main() {
  assert.equal(process.platform, "win32");
  const names = ["package", "profile-origin", "out", "app-port", "relay-port", "debug-port"];
  const { values } = parseArgs({ options: { ...Object.fromEntries([...names, "peer-port", "lan-ip", "fixture-dir", "practice-input", "entry", "cloud-port", "failure"].map(key => [key, { type: "string" }])), "retry-local": { type: "boolean" } } });
  for (const key of names) assert(values[key], "Missing --" + key);
  const input = values["practice-input"], entry = values.entry || "tour";
  const cloudPort = Number(values["cloud-port"] || 0);
  if (values["cloud-port"]) assert(input === "typed" && cloudPort > 0);
  const failure = values.failure;
  if (failure) assert(cloudPort && ["missing", "denied", "quota", "rate", "outage"].includes(failure));
  if (values["retry-local"]) assert(failure && failure !== "denied");
  if (input) assert(["local", "typed", "voice"].includes(input) && ["welcome", "prompter", "tour"].includes(entry) && !values["fixture-dir"]);
  const ports = ["app-port", "relay-port", "debug-port", ...(input ? [] : ["peer-port"])].map(key => Number(values[key]));
  assert(ports.every(p => Number.isInteger(p) && p > 1023 && p <= 65535 && ![4747, 4748, 11434].includes(p)));
  assert.equal(new Set(ports).size, ports.length);
  assert(!ports.includes(cloudPort));
  const [app, relay, debug, peerPort] = ports;
  const ip = values["lan-ip"];
  if (!input) assert(isIPv4(ip) && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip), "Expected private LAN IPv4");
  const manifest = JSON.parse(fs.readFileSync(replayPath(values.package), "utf8"));
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.match(sha, /^[\da-f]{40}$/);
  assert.equal(manifest.sourceSha, sha);
  const digest = createHash("sha512");
  for await (const chunk of fs.createReadStream(replayPath(manifest.archive))) digest.update(chunk);
  const packageSha512 = digest.digest("hex");
  assert.equal(packageSha512, manifest.sha512.toLowerCase());
  const destination = replayPath(manifest.destination);
  const owner = windowOwner(input && entry === "welcome" ? [debug] : [app, relay, debug], destination);
  const dir = replayPath(values.out);
  fs.mkdirSync(dir);
  const fixture = values["fixture-dir"] && replayPath(values["fixture-dir"]);
  const record = { item: failure ? 5 : cloudPort ? 4 : input ? 3 : fixture ? 2 : 1, mode: failure || (cloudPort ? "Approved words-only loopback trial" : input || (fixture ? "Loopback public-link fixture and LAN peer" : "LAN mirror UI")), profileOrigin: values["profile-origin"], sha, packageSha512,
    device: os.hostname(), os: os.version(), owner, ports, command: process.argv, cwd: process.cwd(), start: new Date().toISOString(),
    expected: input ? "Find and activate Save practice through the selected input path" : fixture ? "Decline, cancel connecting, approve a remote phone, receive state, revoke both transports and advance a slide on LAN" : "Local pairing, synchronized slide advance and rejection of the spent code" };
  let desktop, peer, router;
  try {
    if (input) {
      if (cloudPort) router = await openRouterFixture(cloudPort);
      record.observed = await practiceTrial(debug, "http://127.0.0.1:" + app, dir, input, entry, router, failure, Boolean(values["retry-local"]));
      assert.equal(windowOwner([app, relay, debug], destination).pid, owner.pid);
      record.exit = 0;
      return;
    }
    desktop = await attach(debug, url => url === "http://127.0.0.1:" + app + "/" || url === "http://127.0.0.1:" + app);
    peer = await attach(peerPort, url => url === "about:blank");
    if (fixture) record.publicLink = await publicTrial(desktop, owner, fixture, dir, app, relay);
    record.observed = await lanTrial(desktop, peer, dir, "http://" + ip + ":" + app, "http://" + ip + ":" + relay);
    record.exit = 0;
  } catch (err) {
    record.exit = 1;
    // Assertion values may contain a usable pairing link. Keep only the failing call site.
    record.failureSite = String(err.stack).split("\n").find(line => line.includes("n02-windows.mjs:"))?.trim();
    console.error("UI replay failed. See the private evidence directory.");
    process.exitCode = 1;
  } finally {
    if (router) { record.providerRequests = router.requests; await router.close(); }
    peer?.close();
    desktop?.close();
    record.end = new Date().toISOString();
    record.evidence = fs.readdirSync(dir);
    fs.writeFileSync(path.join(dir, "ui.json"), JSON.stringify(record, null, 2), { flag: "wx" });
  }
}

await main();
