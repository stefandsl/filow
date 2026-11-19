import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const [task, work] = process.argv.slice(2);
const { version, sourceSha, checkout, packageDir, basePort } = JSON.parse(fs.readFileSync(path.join(work, 'inputs.json'), 'utf8'));
const marker = 'Filow release acceptance ' + sourceSha.slice(0, 7);
const targetFile = path.join(work, 'saved-report.txt');
const visibleReport = '(() => { const p = document.querySelector("#preview"); return p?.getClientRects().length && p.textContent; })()';

async function waitFor(read, description) {
  const expires = Date.now() + 20_000;
  do {
    const value = await read();
    if (value) return value;
    await delay(200);
  } while (Date.now() < expires);
  throw Error('Timed out waiting for ' + description);
}

async function pages() {
  const res = await fetch(`http://127.0.0.1:${basePort + 3}/json/list`, { signal: AbortSignal.timeout(3000) });
  assert(res.ok, 'Could not list packaged windows');
  return (await res.json()).filter(t => t.type === 'page');
}

async function openPage(matches) {
  const target = await waitFor(async () => (await pages()).find(t => matches(new URL(t.url))), 'packaged page');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(Error('Could not connect to packaged page'));
  });
  let id = 0;
  return {
    close: () => socket.close(),
    // Evaluations run sequentially. CDP may also send unsolicited events.
    evaluate(expression) {
      const key = ++id;
      return new Promise((resolve, reject) => {
        socket.onclose = () => reject(Error('Packaged page disconnected'));
        socket.onmessage = ({ data }) => {
          const reply = JSON.parse(data);
          if (reply.id !== key) return;
          if (reply.error || reply.result.exceptionDetails) reject(Error('Packaged page evaluation failed'));
          else resolve(reply.result.result.value);
        };
        socket.send(JSON.stringify({ id: key, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
      });
    },
  };
}

function reportBody(report) {
  const text = report.replaceAll('\r\n', '\n');
  const header = /^Filow problem report\nMade on (\d{4}-\d{2}-\d{2} \d{2}:\d{2})\. Filow did not send this file anywhere\.\n/;
  const stamp = text.match(header)?.[1];
  assert(stamp, 'Missing report date');
  // Preview and Save independently read the local clock, rounded to the minute.
  const pad = value => String(value).padStart(2, '0');
  const minute = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  assert([0, 1, 2].some(n => minute(new Date(Date.now() - n * 60_000)) === stamp), 'Unexpected report timestamp');
  return text.replace(header, 'Filow problem report\n');
}

async function checkAbout() {
  const origin = `http://127.0.0.1:${basePort}`;
  const main = await openPage(url => url.origin === origin && url.pathname === '/');
  try {
    await main.evaluate("localStorage.setItem('prefs:lang', 'en'); location.assign('/settings/local'); true");
  } finally { main.close(); }
  const settings = await openPage(url => url.origin === origin && url.pathname === '/settings/local');
  try {
    await waitFor(() => settings.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'About and privacy');
      if (!button || button.disabled || !button.getClientRects().length) return false;
      button.click();
      return true;
    })()`), 'Settings About button');
  } finally { settings.close(); }
}

async function checkUI() {
  if (task === 'about') await checkAbout();
  const page = await openPage(url => url.protocol === 'file:' && url.pathname.endsWith('/about.html'));
  try {
    if (task === 'about') {
      const line = await waitFor(() => page.evaluate('document.querySelector(".version")?.innerText'), 'About version');
      const fields = line.split(' · ');
      assert(fields[0] === 'Version ' + version && fields.includes('Build ' + sourceSha.slice(0, 7)), 'About candidate identity mismatch');
      const configFolder = await page.evaluate('document.querySelector("code.path")?.innerText');
      assert(configFolder === process.env.FILOW_USER_DATA_DIR, 'About shows a different profile');
      const policy = await page.evaluate('document.querySelector("article.policy")?.innerText');
      assert(policy?.startsWith('Filow privacy policy') && policy.length > 1000, 'Offline policy missing');
      console.log(`About shows ${version}, build ${sourceSha.slice(0, 7)} and the offline privacy policy (${policy.length} characters).`);
    } else if (task === 'save') {
      await page.evaluate('document.querySelector("#tab-report").click()');
      await waitFor(() => page.evaluate('document.querySelector("#open-issue")?.disabled === false'), 'report');
      await page.evaluate(`document.querySelector("#describe").value = ${JSON.stringify(marker)}; document.querySelector("#describe").dispatchEvent(new Event("input", { bubbles:true })); true`);
      const preview = await waitFor(async () => {
        const text = await page.evaluate(visibleReport);
        return text && text.includes(marker) && text;
      }, 'visible report preview');
      const body = reportBody(preview);
      for (const heading of ['What happened', 'This computer and Filow', 'Dictation and keys', 'Log of the last take', 'Start-up log (last lines)']) {
        assert(body.includes('\n== ' + heading + '\n'), 'Missing report section ' + heading);
      }
      assert(body.includes('\n' + marker + '\n') && body.includes('Filow ' + version + ' · Electron ') && body.includes('offline on'), 'Report contents mismatch');
      fs.writeFileSync(path.join(work, 'report-preview.txt'), preview);
      fs.writeFileSync(path.join(work, 'packaged-pages.json'), JSON.stringify((await pages()).map(t => t.id).sort()));
      await page.evaluate('Array.from(document.querySelectorAll(".actions button")).find(b => b.textContent.startsWith("Save to a file")).click()');
    } else {
      const status = await waitFor(() => page.evaluate('document.querySelector("#status")?.innerText'), 'save confirmation');
      assert(status === 'Saved to ' + targetFile, 'Report save confirmation mismatch');
      const visible = await page.evaluate(visibleReport);
      const saved = fs.readFileSync(targetFile, 'utf8');
      const before = fs.readFileSync(path.join(work, 'report-preview.txt'), 'utf8');
      assert(reportBody(saved) === reportBody(visible) && reportBody(saved) === reportBody(before), 'Saved file differs from the visible report');
      assert(JSON.stringify((await pages()).map(t => t.id).sort()) === fs.readFileSync(path.join(work, 'packaged-pages.json'), 'utf8'), 'Packaged windows changed during Save');
      console.log('Saved file matches the visible report, allowing for the generated report time.');
    }
  } finally { page.close(); }
}

if (task === 'identity') {
  const require = createRequire(path.join(checkout, 'package.json'));
  const asar = require('@electron/asar');
  const archive = path.join(packageDir, 'resources', 'app.asar');
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  assert(pkg.name === '@filow/desktop' && pkg.version === version && pkg.sourceSha === sourceSha, 'Packaged version or full source SHA mismatch');
} else {
  assert(['about', 'save', 'saved'].includes(task), 'Unknown acceptance action');
  // Bound socket handshakes and renderer calls, including a renderer that hangs mid-action.
  const timeout = setTimeout(() => { console.error('Packaged UI timed out at ' + task); process.exit(1); }, 45_000);
  try { await checkUI(); } finally { clearTimeout(timeout); }
}
