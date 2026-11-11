#!/usr/bin/env node
// What does the online account's privacy filter do to a sentence before the model sees it?
// Sends each sentence to OpenRouter with the request "repeat it exactly" and prints what comes
// back: a name the filter hid comes back as a placeholder ("[PERSON_NAME]"), a spelling it lets
// through comes back as written. This is a paid call (a few tokens a sentence), so it runs only
// with --yes-send, and it is never run by the tests.
//
// Usage: node tools/whiteboard/echo.mjs --yes-send "Hans Krebs described the Krebs cycle" "The K r e b s cycle" ...
//        node tools/whiteboard/echo.mjs --yes-send --name Krebs      (the name in every spelling Filow can use)
// Reads OPENROUTER_API_KEY; the model is WHITEBOARD_CLOUD_MODEL, else BUDDY_CLOUD_MODEL, else google/gemini-2.5-flash.
const args = process.argv.slice(2);
const send = args.includes("--yes-send");
const nameAt = args.indexOf("--name");
const name = nameAt >= 0 ? args[nameAt + 1] : "";
const spell = (n, sep) => Array.from(n).join(sep);
const sentences = name
  ? [`The ${name} cycle in outline`, `The ${spell(name, " ")} cycle in outline`, `The ${spell(name, "-")} cycle in outline`, `The ${spell(name, ".")} cycle in outline`, `The cycle named ${name.toLowerCase()} in outline`]
  : args.filter((a, i) => !a.startsWith("--") && i !== nameAt + 1);
const key = process.env.OPENROUTER_API_KEY;
const base = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
const model = process.env.WHITEBOARD_CLOUD_MODEL || process.env.BUDDY_CLOUD_MODEL || "google/gemini-2.5-flash";
if (!sentences.length) {
  console.error('usage: node tools/whiteboard/echo.mjs --yes-send "a sentence" ["another"]   or   --yes-send --name Krebs');
  process.exit(2);
}
if (!send || !key) {
  console.error(`Nothing was sent. This would send ${sentences.length} short sentence(s) to ${base} (model ${model}), a paid call.${key ? "" : " OPENROUTER_API_KEY is not set."} Repeat with --yes-send to run it.`);
  for (const s of sentences) console.error(`  would send: ${s}`);
  process.exit(2);
}
for (const sentence of sentences) {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 120, messages: [{ role: "system", content: "Repeat the user's message exactly, character for character. Output nothing else." }, { role: "user", content: sentence }] }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || typeof json?.choices?.[0]?.message?.content !== "string") {
    // the provider did not answer (a 429 when it is busy): this spelling was not tested, which is not the same as "came back changed"
    console.log(`sent: ${sentence}\n=> NOT TESTED (HTTP ${res.status}${json?.error?.message ? `: ${String(json.error.message).slice(0, 120)}` : ""})\n`);
    continue;
  }
  const echo = json.choices[0].message.content;
  const hidden = /[[<{]\s*[A-Z][A-Z_ ]{2,}\s*[\]>}]/.test(String(echo));
  console.log(`sent: ${sentence}\necho: ${String(echo).trim()}\n=> ${hidden ? "HIDDEN (a placeholder came back)" : String(echo).trim() === sentence ? "came back as written" : "came back changed"}\n`);
}
