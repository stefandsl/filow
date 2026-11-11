/* global window, document, location, HTMLTextAreaElement */
// about.html: "About and privacy" and "Report a problem". Everything shown comes from the main process
// (about.js) as plain data and is put on the page with textContent: no HTML from any file is parsed.
(() => {
  const api = window.filowAbout;
  const main = document.getElementById("main");
  let data = null;
  let view = "about";
  let description = "";
  let previewTimer = 0;

  /** el("p", { class: "x", text: "..." }, child, ...) */
  function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    }
    for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
    return node;
  }
  const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

  /** A placeholder only the publisher can fill: visible as [[...]] and announced as "not filled in yet". */
  const todo = (text) => el("mark", { class: "todo" }, `[[${text}]]`, el("span", { class: "sr", text: ` (${data.text.todo})` }));

  function inline(parent, spans) {
    for (const s of spans) {
      if (s.t === "text") parent.append(s.v);
      else if (s.t === "b") parent.append(el("strong", { text: s.v }));
      else if (s.t === "code") parent.append(el("code", { text: s.v }));
      else if (s.t === "todo") parent.append(todo(s.v));
      else if (s.t === "link") parent.append(el("a", { href: s.href, text: s.v }));
    }
    return parent;
  }

  /** One policy block. Headings move one level down: the page's own title is the only h1. */
  function block(b) {
    if (b.type === "h") return inline(el(`h${Math.min(4, b.level + 1)}`), b.inline);
    if (b.type === "p") return inline(el("p"), b.inline);
    if (b.type === "quote") return el("div", { class: "note" }, inline(el("p"), b.inline));
    if (b.type === "ul" || b.type === "ol") return el(b.type, {}, ...b.items.map((i) => inline(el("li"), i)));
    if (b.type === "table") {
      const head = el("tr", {}, ...b.head.map((c) => inline(el("th", { scope: "col" }), c)));
      const rows = b.rows.map((r) => el("tr", {}, ...r.map((c) => inline(el("td"), c))));
      return el("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": b.head.map((c) => c.map((s) => s.v).join("")).join(", ") },
        el("table", {}, el("thead", {}, head), el("tbody", {}, ...rows)));
    }
    return null;
  }

  function aboutView() {
    const tx = data.text;
    const facts = el("ul", { class: "facts" }, el("li", { text: tx.fact1 }), el("li", { text: tx.fact2 }));
    const folder = el("div", { class: "folder" },
      el("span", { class: "label", text: tx.configFolder }),
      el("code", { class: "path", text: data.info.configFolder }),
      el("button", { type: "button", class: "btn", text: tx.openFolder, onclick: () => void api.openConfigFolder() }));
    const policy = data.policy.length
      ? el("article", { class: "policy" }, ...data.policy.map(block))
      : el("p", { class: "warn", role: "alert", text: tx.policyMissing });
    return [
      el("h1", { tabindex: "-1", text: tx.tabAbout }),
      el("p", { class: "version", text: `${fill(tx.version, { version: data.info.version })} · Electron ${data.info.electron}` }),
      facts, folder, policy,
    ];
  }

  function reportView() {
    const tx = data.text;
    const preview = el("pre", { id: "preview", class: "preview", tabindex: "0", "aria-label": tx.contents, text: tx.loading });
    const status = el("p", { id: "status", class: "status", role: "status", "aria-live": "polite" });
    const crash = el("div", { class: "crash" });
    const say = (text, bad) => { status.textContent = text; status.classList.toggle("bad", Boolean(bad)); };
    const area = el("textarea", { id: "describe", rows: "4", "aria-describedby": "describe-hint", maxlength: "4000",
      oninput: (e) => {
        description = e.target.value;
        clearTimeout(previewTimer);
        previewTimer = setTimeout(async () => { preview.textContent = await api.preview(description); }, 200);
      } });
    area.value = description;
    // The report leaves this PC only here: the notice sits right above the button and is read with it.
    const issue = el("button", { type: "button", id: "open-issue", class: "btn primary", text: tx.issueOpen, disabled: true, "aria-describedby": "issue-notice", onclick: async () => {
      clearTimeout(previewTimer);
      preview.textContent = await api.preview(description);
      const r = await api.issue(description);
      if (r && r.opened) say(tx.issueOpened);
      else say(fill(tx.issueFailed, { url: data.support.issues }), true);
    } });
    const save = el("button", { type: "button", class: "btn", text: tx.save, disabled: true, onclick: async () => {
      // the preview catches up first, so what is on screen is what goes in the file
      clearTimeout(previewTimer);
      preview.textContent = await api.preview(description);
      const r = await api.save(description);
      if (r.saved) say(fill(tx.saved, { file: r.saved }));
      else if (r.error) say(fill(tx.saveFailed, { error: r.error }), true);
    } });
    const copy = el("button", { type: "button", class: "btn", text: tx.copy, disabled: true, onclick: async () => { await api.copy(description); say(tx.copied); } });
    void api.report().then((r) => {
      preview.textContent = description ? preview.textContent : r.preview;
      if (description) void api.preview(description).then((t) => { preview.textContent = t; });
      crash.replaceChildren(r.crash.count
        ? el("p", {}, fill(tx.crashSome, { count: r.crash.count, size: r.crash.mb }), " ",
          el("button", { type: "button", class: "btn link", text: tx.openCrash, onclick: () => void api.openCrashFolder() }))
        : el("p", { text: tx.crashNone }));
      issue.disabled = false;
      save.disabled = false;
      copy.disabled = false;
    });
    return [
      el("h1", { tabindex: "-1", text: tx.tabReport }),
      el("p", { class: "lead", text: tx.issueIntro }),
      el("label", { for: "describe", class: "field-label", text: tx.describe }),
      el("p", { id: "describe-hint", class: "hint", text: tx.describeHint }),
      area,
      el("h2", { text: tx.contents }),
      el("p", { class: "hint", text: tx.masked }),
      preview, crash,
      el("h2", { text: tx.issueHeading }),
      el("div", { class: "note", id: "issue-notice" }, el("p", { text: tx.issuePublic })),
      el("div", { class: "actions" }, issue, save, copy, el("button", { type: "button", class: "btn", text: tx.close, onclick: () => void api.close() })),
      status,
    ];
  }

  function render(next, focus) {
    view = next === "report" ? "report" : "about";
    document.title = `Filow - ${view === "report" ? data.text.tabReport : data.text.tabAbout}`;
    for (const b of document.querySelectorAll("#tabs button")) {
      if (b.dataset.view === view) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
    main.replaceChildren(...(view === "report" ? reportView() : aboutView()));
    main.scrollTop = 0;
    window.scrollTo(0, 0);
    if (focus) main.querySelector("h1")?.focus();
  }

  async function start() {
    data = await api.data();
    document.documentElement.lang = data.lang;
    document.documentElement.dataset.theme = data.theme;
    document.getElementById("tab-about").textContent = data.text.tabAbout;
    document.getElementById("tab-report").textContent = data.text.tabReport;
    for (const b of document.querySelectorAll("#tabs button")) b.addEventListener("click", () => render(b.dataset.view, true));
    api.onView((v) => render(v, true));
    // Escape closes, except while an input method is composing or the description holds text.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.isComposing || e.keyCode === 229) return;
      if (e.target instanceof HTMLTextAreaElement && e.target.value) return;
      void api.close();
    });
    render(data.view || (location.hash === "#report" ? "report" : "about"), false);
  }
  void start();
})();
