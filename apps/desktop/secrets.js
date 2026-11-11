// API keys at rest (docs/autoloop/STANDARDS.md SEC-14). Users still paste keys into userData/.env, the
// file the menu opens. At startup every real secret found there is encrypted with the OS key store
// (Electron safeStorage: DPAPI on Windows, Keychain on macOS, libsecret on Linux) into secrets.json,
// and its line in .env is blanked with a note. Typing a new value in .env replaces the stored one on
// the next start. When encryption is not available the file is left as it is.

const SECRET_NAME = /^[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)$/;
const NOTE = "# stored encrypted by Filow; type a new value after = to replace it";

const isPlaceholder = (v) => !v || /^(your|<|xxx|changeme|sk-\.\.\.)/i.test(v) || v.includes("...");

/**
 * Splits .env text into the text to keep (secrets blanked) and the secrets found.
 * @returns {{ text: string, found: Record<string, string> }}
 */
function extractSecrets(envText) {
  const nl = envText.includes("\r\n") ? "\r\n" : "\n";
  const lines = envText.split(/\r?\n/);
  const found = {};
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && SECRET_NAME.test(m[1])) {
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!isPlaceholder(val)) {
        found[m[1]] = val;
        if (out[out.length - 1] !== NOTE) out.push(NOTE);
        out.push(`${m[1]}=`);
        continue;
      }
    }
    out.push(lines[i]);
  }
  return { text: out.join(nl), found };
}

/**
 * Moves secrets from .env into the encrypted store, then returns every stored secret decrypted.
 * fsx: { read(path) -> string|null, write(path, text) }; crypto: { available(), encrypt(s) -> base64, decrypt(base64) -> s }
 */
function migrateSecrets({ envFile, storeFile, fsx, crypto, log = () => {} }) {
  if (!crypto.available()) return {};
  let store;
  try { store = JSON.parse(fsx.read(storeFile) || "{}"); } catch { store = {}; }
  const envText = fsx.read(envFile);
  if (envText != null) {
    const { text, found } = extractSecrets(envText);
    const names = Object.keys(found);
    if (names.length) {
      for (const n of names) store[n] = crypto.encrypt(found[n]);
      fsx.write(storeFile, JSON.stringify(store, null, 2));
      fsx.write(envFile, text);
      log(`secrets: encrypted ${names.join(", ")}`);
    }
  }
  const out = {};
  for (const [n, enc] of Object.entries(store)) {
    try { out[n] = crypto.decrypt(enc); } catch { log(`secrets: cannot decrypt ${n} (another user or PC?)`); }
  }
  return out;
}

/**
 * Stores one secret typed in a settings page (encrypted, same store), or removes it when `value` is
 * empty. Returns false, storing nothing, when the OS key store is not available: a key is never
 * written in clear text by this path.
 */
function setSecret({ storeFile, fsx, crypto }, name, value) {
  if (!SECRET_NAME.test(name)) throw new Error("not a secret name");
  if (!crypto.available()) return false;
  let store;
  try { store = JSON.parse(fsx.read(storeFile) || "{}"); } catch { store = {}; }
  if (value) store[name] = crypto.encrypt(String(value));
  else delete store[name];
  fsx.write(storeFile, JSON.stringify(store, null, 2));
  return true;
}

module.exports = { extractSecrets, migrateSecrets, setSecret, SECRET_NAME, NOTE };
