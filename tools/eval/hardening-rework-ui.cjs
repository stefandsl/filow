// Hidden string/layout QA only. Not a packaged onboarding or native uninstall acceptance test.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = 'G:/FILOW/tmp/hardening';
if (process.env.FILOW_QA_HEADLESS !== '1' || process.env.FILOW_QA_NO_GLOBAL_INPUT !== '1') throw Error('QA isolation required');
app.setPath('userData', path.join(root, 'qa-profile'));
app.setPath('appData', root);
app.commandLine.appendSwitch('remote-debugging-port', '9591');
app.disableHardwareAcceleration();
const { t, LANGS } = require(path.join(root, 'i18n.cjs'));
const tokens = fs.readFileSync(path.join(__dirname, '../../apps/web/app/theme-tokens.css'), 'utf8');
const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
let server; let window;
const exit = code => { window?.destroy(); server?.close(); app.exit(code); };
setTimeout(() => exit(2), 120000).unref();
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_w, _p, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('http://127.0.0.1:4991/') }));
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:4991');
    const lang = LANGS.includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'en';
    const theme = url.searchParams.get('theme') === 'light' ? 'light' : 'dark';
    const keys = ['local.pointerLabel', 'local.pointerHere', 'local.noAnswer'];
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="${lang}" data-theme="${theme}"><head><style>${tokens}
      body{background:var(--bg,#12151b);color:var(--text,#eee);font:18px/1.55 system-ui;margin:32px} section{max-width:680px;padding:20px;margin:20px 0;border:1px solid var(--border,#69717a);border-radius:16px} p{margin:0;overflow-wrap:anywhere} .mark{display:inline-block;border:3px solid #42a87a;padding:5px 20px;margin:12px 0}
      </style></head><body>${keys.map((key, i) => `<section><p data-key="${key}">${escape(t(key, lang, { label: ({en:'Customer name field',it:'Campo Nome cliente',ru:'\u041f\u043e\u043b\u0435 \u0438\u043c\u0435\u043d\u0438',ro:'Câmp nume client',ja:'\u9867\u5ba2\u540d\u6b04'})[lang] }))}</p>${i === 0 ? '<span class="mark">1</span>' : ''}</section>`).join('')}</body></html>`);
  });
  await new Promise(r => server.listen(4991, '127.0.0.1', r));
  window = new BrowserWindow({ show: false, width: 900, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const rows = [];
  for (const theme of ['dark', 'light']) for (const lang of LANGS) {
    await window.loadURL(`http://127.0.0.1:4991/?lang=${lang}&theme=${theme}`);
    const measured = await window.webContents.executeJavaScript(`({text:Array.from(document.querySelectorAll('[data-key]')).map(e=>e.textContent),overflow:document.documentElement.scrollWidth>innerWidth,bg:getComputedStyle(document.body).backgroundColor,color:getComputedStyle(document.body).color})`);
    const expected = ['local.pointerLabel', 'local.pointerHere', 'local.noAnswer'].map(k => t(k, lang, { label: ({en:'Customer name field',it:'Campo Nome cliente',ru:'\u041f\u043e\u043b\u0435 \u0438\u043c\u0435\u043d\u0438',ro:'Câmp nume client',ja:'\u9867\u5ba2\u540d\u6b04'})[lang] }));
    if (window.isVisible() || measured.overflow || JSON.stringify(expected) !== JSON.stringify(measured.text) || measured.bg === measured.color) throw Error('QA mismatch');
    fs.writeFileSync(path.join(root, `rework-strings-${theme}-${lang}.png`), (await window.webContents.capturePage()).toPNG());
    rows.push({ lang, theme, hidden: !window.isVisible(), ...measured });
  }
  fs.writeFileSync(path.join(root, 'rework-ui.json'), JSON.stringify(rows, null, 2)); exit(0);
}).catch(error => { fs.writeFileSync(path.join(root, 'ui-error.txt'), String(error.stack)); exit(1); });
