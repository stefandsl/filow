// "About and privacy" and "Report a problem": one local window (about.html) with two views. The
// privacy policy ships inside the package (docs/PRIVACY.md, docs/PRIVACY.it.md as extraResources) and
// is read from disk: no remote fetch, so it opens offline and always matches this version of the app.
// The problem report is made, shown line by line and saved to a file the user picks. Filow sends it
// nowhere; where the user can send it privately is the owner's to fill in (docs/OWNER-DECISIONS.md D33).

/** Where users send a saved report. Empty until the owner decides (D33); the page says it is not set. */
const SUPPORT = { email: "", form: "" };

const TEXT = {
  en: {
    tabAbout: "About and privacy", tabReport: "Report a problem", version: "Version {version}",
    fact1: "No account. No telemetry: Filow does not tell anyone how you use it.",
    fact2: "Your script, settings and logs stay in your config folder on this computer.",
    configFolder: "Your config folder", openFolder: "Open the folder", todo: "not filled in yet",
    policyMissing: "The privacy policy file is missing from this installation. Reinstall Filow to get it back.",
    reportIntro: "Filow does not send this report anywhere. Save it to a file, read it, then send it yourself, privately.",
    whereTo: "Where to send it", supportUnset: "Not set in this version yet.", supportTodo: "support e-mail address or form, added by the publisher",
    writeMail: "Write an e-mail", openForm: "Open the support form",
    describe: "What happened? (optional)", describeHint: "What you did, what you expected and what happened instead. It goes at the top of the file.",
    contents: "Exactly what the file will contain",
    masked: "Masked before you see it: public links, keys and passwords, e-mail addresses, local network addresses and your user name.",
    crashNone: "No crash files on this computer.",
    crashSome: "Not included: {count} crash files ({size} MB). They can hold parts of what was on screen, so send them only if support asks for them.",
    openCrash: "Open the crash files folder",
    save: "Save to a file…", copy: "Copy the text", close: "Close",
    saved: "Saved to {file}", copied: "Copied. Paste it into your message.", saveFailed: "Could not save the file: {error}",
    saveTitle: "Save the problem report", loading: "Collecting the report…",
    fileTitle: "Filow problem report", fileMade: "Made on {date}. Filow did not send this file anywhere.",
    fileWhat: "What happened", fileNone: "(not written)", fileCrash: "Crash files not included: {count} ({size} MB).",
    fileSystem: "This computer and Filow", fileTake: "Log of the last take", fileLog: "Start-up log (last lines)", fileNoTake: "(no take since Filow started)",
  },
  it: {
    tabAbout: "Informazioni e privacy", tabReport: "Segnala un problema", version: "Versione {version}",
    fact1: "Nessun account. Nessuna telemetria: Filow non dice a nessuno come lo usi.",
    fact2: "Il tuo copione, le impostazioni e i registri restano nella cartella di configurazione su questo computer.",
    configFolder: "La tua cartella di configurazione", openFolder: "Apri la cartella", todo: "non ancora compilato",
    policyMissing: "In questa installazione manca il file dell'informativa sulla privacy. Reinstalla Filow per riaverlo.",
    reportIntro: "Filow non invia questa segnalazione da nessuna parte. Salvala in un file, leggila, poi inviala tu, in privato.",
    whereTo: "Dove inviarla", supportUnset: "Non ancora indicato in questa versione.", supportTodo: "indirizzo e-mail o modulo di assistenza, aggiunto dall'editore",
    writeMail: "Scrivi un'e-mail", openForm: "Apri il modulo di assistenza",
    describe: "Cosa è successo? (facoltativo)", describeHint: "Cosa hai fatto, cosa ti aspettavi e cosa è successo invece. Va in cima al file.",
    contents: "Esattamente cosa conterrà il file",
    masked: "Mascherati prima che tu li veda: link pubblici, chiavi e password, indirizzi e-mail, indirizzi della rete locale e il tuo nome utente.",
    crashNone: "Nessun file di crash su questo computer.",
    crashSome: "Non inclusi: {count} file di crash ({size} MB). Possono contenere parti di quello che era sullo schermo: inviali solo se l'assistenza li chiede.",
    openCrash: "Apri la cartella dei file di crash",
    save: "Salva in un file…", copy: "Copia il testo", close: "Chiudi",
    saved: "Salvato in {file}", copied: "Copiato. Incollalo nel tuo messaggio.", saveFailed: "Impossibile salvare il file: {error}",
    saveTitle: "Salva la segnalazione", loading: "Raccolgo la segnalazione…",
    fileTitle: "Segnalazione di un problema in Filow", fileMade: "Creata il {date}. Filow non ha inviato questo file da nessuna parte.",
    fileWhat: "Cosa è successo", fileNone: "(non scritto)", fileCrash: "File di crash non inclusi: {count} ({size} MB).",
    fileSystem: "Questo computer e Filow", fileTake: "Registro dell'ultima sessione", fileLog: "Registro di avvio (ultime righe)", fileNoTake: "(nessuna sessione da quando Filow è partito)",
  },
};

const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const textFor = (lang) => TEXT[lang] || TEXT.en;

// ---- the policy: a small Markdown reader for the subset docs/PRIVACY*.md uses ----
// It returns plain data (no HTML): the page builds DOM nodes with textContent, so nothing in the file
// can become markup or script.

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[\[[^\]]+\]\])|(\[([^\]]+)\]\(((?:https:\/\/|mailto:)[^)\s]+)\))/g;

/** Inline spans: text, bold, code, todo (a [[placeholder]] only the owner can fill) and https/mailto links. */
function parseInline(text) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(INLINE)) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    if (m[1]) out.push({ t: "code", v: m[1].slice(1, -1) });
    else if (m[2]) out.push({ t: "b", v: m[2].slice(2, -2) });
    else if (m[3]) out.push({ t: "todo", v: m[3].slice(2, -2) });
    else out.push({ t: "link", v: m[5], href: m[6] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => parseInline(c.trim()));

/** Blocks: h (level 1-3), p, quote, ul, ol, table. Lines of one paragraph or list item are joined. */
function parseMarkdown(source) {
  const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let para = null, list = null, quote = null;
  const flush = () => {
    if (para) blocks.push({ type: "p", inline: parseInline(para.join(" ")) });
    if (quote) blocks.push({ type: "quote", inline: parseInline(quote.join(" ")) });
    if (list) blocks.push({ type: list.type, items: list.items.map((i) => parseInline(i.join(" "))) });
    para = list = quote = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    let m;
    if (!trimmed) { flush(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(trimmed))) { flush(); blocks.push({ type: "h", level: m[1].length, inline: parseInline(m[2]) }); continue; }
    if (trimmed.startsWith("|") && /^\|?\s*:?-{3,}/.test((lines[i + 1] || "").trim())) {
      flush();
      const head = cells(trimmed), rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      i -= 1;
      blocks.push({ type: "table", head, rows });
      continue;
    }
    if ((m = /^>\s?(.*)$/.exec(trimmed))) { if (!quote) { flush(); quote = []; } quote.push(m[1]); continue; }
    const bullet = /^-\s+(.*)$/.exec(trimmed), numbered = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      const type = bullet ? "ul" : "ol";
      if (!list || list.type !== type) { flush(); list = { type, items: [] }; }
      list.items.push([(bullet || numbered)[1]]);
      continue;
    }
    if (list && /^\s{2,}/.test(line)) { list.items[list.items.length - 1].push(trimmed); continue; }
    if (!para) { flush(); para = []; }
    para.push(trimmed);
  }
  flush();
  return blocks;
}

/** The policy file for this language: Italian when the app speaks Italian and the file exists. */
function policyFile(docsDir, lang, exists, join) {
  const it = join(docsDir, "PRIVACY.it.md");
  return lang === "it" && exists(it) ? it : join(docsDir, "PRIVACY.md");
}

// ---- the problem report ----

/** Crash dumps under the Crashpad folder: how many and how big (they are never put in the report). */
function crashSummary(dir, fs, join) {
  let count = 0, bytes = 0;
  const walk = (d, depth) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && /\.dmp$/i.test(e.name)) {
        count += 1;
        try { bytes += fs.statSync(p).size; } catch { /* gone meanwhile */ }
      }
    }
  };
  walk(dir, 0);
  return { count, mb: Math.round((bytes / 1024 ** 2) * 10) / 10 };
}

/** The whole file: title, the user's own words on top, then the diagnostic sections main.js collected ({ id, text }). */
function reportFile({ lang, date, description, sections, crash }) {
  const tx = textFor(lang);
  const words = String(description || "").trim().slice(0, 4000);
  const parts = [
    tx.fileTitle, fill(tx.fileMade, { date }), "",
    `== ${tx.fileWhat}`, words || tx.fileNone, "",
    ...sections.flatMap((s) => {
      const title = { system: tx.fileSystem, take: tx.fileTake, log: tx.fileLog }[s.id] || s.id;
      const body = String(s.text || "").trimEnd() || (s.id === "take" ? tx.fileNoTake : tx.fileNone);
      return [`== ${title}`, body, ""];
    }),
  ];
  if (crash && crash.count) parts.push(fill(tx.fileCrash, { count: crash.count, size: crash.mb }));
  return parts.join("\n").trimEnd() + "\n";
}

const reportName = (date) => `filow-report-${date.slice(0, 10)}.txt`;

// ---- the window ----

/**
 * deps: BrowserWindow, ipcMain, dialog, clipboard, shell, openExternalSafe, logLine, fs, path,
 * pageFile (about.html), preload, lang(), theme(), icon(), info() -> { version, electron, configFolder },
 * docsDir, crashDir, documentsDir, collectReport() -> Promise<[{ title, text }]>.
 */
function createAboutPages(deps) {
  const { BrowserWindow, ipcMain, dialog, clipboard, shell, openExternalSafe, logLine, fs, path } = deps;
  let win = null;
  let sections = null; // collected when the report view opens, so the file matches what was shown
  const own = (event) => Boolean(win && !win.isDestroyed() && event.sender === win.webContents);
  const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => {
    if (!own(event)) throw new Error("Denied");
    return fn(...args);
  });
  const now = () => new Date().toISOString().replace("T", " ").slice(0, 16);

  function policy() {
    const file = policyFile(deps.docsDir, deps.lang(), fs.existsSync, path.join);
    try {
      return { blocks: parseMarkdown(fs.readFileSync(file, "utf8")), file };
    } catch (err) {
      logLine(`about: privacy policy not readable at ${file}: ${err.message}`);
      return { blocks: [], file };
    }
  }
  const crash = () => crashSummary(deps.crashDir, fs, path.join);
  const fileText = (description) => reportFile({ lang: deps.lang(), date: now(), description, sections: sections || [], crash: crash() });

  handle("about:data", () => ({ lang: deps.lang(), theme: deps.theme(), text: textFor(deps.lang()), info: deps.info(), policy: policy().blocks, support: SUPPORT }));
  handle("about:openConfigFolder", () => shell.openPath(deps.info().configFolder));
  handle("report:data", async () => {
    sections = await deps.collectReport();
    return { preview: fileText(""), crash: crash() };
  });
  handle("report:preview", (description) => fileText(description));
  handle("report:save", async (description) => {
    const tx = textFor(deps.lang());
    const r = await dialog.showSaveDialog(win, { title: tx.saveTitle, defaultPath: path.join(deps.documentsDir(), reportName(now())), filters: [{ name: "Text", extensions: ["txt"] }] });
    if (r.canceled || !r.filePath) return { canceled: true };
    try {
      const text = fileText(description);
      fs.writeFileSync(r.filePath, text, "utf8");
      logLine(`report: saved to a file the user picked (${text.length} chars)`);
      return { saved: r.filePath };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });
  handle("report:copy", (description) => { clipboard.writeText(fileText(description)); return true; });
  handle("report:openCrashFolder", () => shell.openPath(deps.crashDir));
  handle("report:support", (kind) => {
    if (kind === "email" && SUPPORT.email) return openExternalSafe(`mailto:${SUPPORT.email}?subject=${encodeURIComponent("Filow problem report")}`);
    if (kind === "form" && SUPPORT.form) return openExternalSafe(SUPPORT.form);
    return undefined;
  });
  handle("about:close", () => { if (win && !win.isDestroyed()) win.close(); });

  /** Opens (or brings forward) the window on "about" or "report". */
  function open(view = "about") {
    const hash = view === "report" ? "report" : "about";
    if (win && !win.isDestroyed()) {
      win.webContents.send("about:view", hash);
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return win;
    }
    win = new BrowserWindow({
      width: 880, height: 760, minWidth: 480, minHeight: 420, show: false, title: "Filow", icon: deps.icon(),
      backgroundColor: deps.theme() === "dark" ? "#121212" : "#f6f7f9", autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: deps.preload },
    });
    win.setMenuBarVisibility(false);
    // A local page with nowhere to go: links leave for the system browser (https and mailto only).
    win.webContents.on("will-navigate", (event, url) => { event.preventDefault(); void openExternalSafe(url); });
    win.webContents.setWindowOpenHandler(({ url }) => { void openExternalSafe(url); return { action: "deny" }; });
    win.once("ready-to-show", () => win && !win.isDestroyed() && win.show());
    win.on("closed", () => { win = null; sections = null; });
    void win.loadFile(deps.pageFile, { hash });
    return win;
  }
  return { open };
}

module.exports = { createAboutPages, parseMarkdown, parseInline, policyFile, crashSummary, reportFile, reportName, TEXT, SUPPORT };
