import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
export const sourceRepo = 'stefandsl/filow';
export const feedRepo = 'stefandsl/filow-releases';
// D6 and the production account deployment are owner decisions. No origin is approved yet.
export const allowedOrigins = [];
export const manifests = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'];
export const requiredJobs = ['checks', 'build (macos-latest, desktop:build:mac)',
  'build (ubuntu-latest, desktop:build:linux)', 'build (windows-latest, desktop:build:win)'];
const builtAllPlatforms = run => requiredJobs.every(name => run?.jobs?.some(j => j.name === name && j.conclusion === 'success'));
export function expectedAssets(v) {
  return [...manifests, `Filow-extension-${v}.zip`,
    ...['win-x64.exe', 'win-x64.exe.blockmap', 'win-x64-portable.exe',
      'linux-amd64.deb', 'linux-x86_64.AppImage',
      ...['arm64', 'x64'].flatMap(a => [`mac-${a}.dmg`, `mac-${a}.dmg.blockmap`, `mac-${a}.zip`, `mac-${a}.zip.blockmap`])]
      .map(s => `Filow-${v}-${s}`)];
}
function check(ok, message) { if (!ok) throw new Error(message); }
function version(v) {
  check(typeof v === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v), `Invalid stable version: ${v}`);
  return v.split('.').map(BigInt);
}
export function newer(a, b) {
  const aa = version(a), bb = version(b);
  for (let i = 0; i < 3; i++) { if (aa[i] !== bb[i]) return aa[i] > bb[i]; }
  return false;
}
export function verifyMain(onMain) {
  check(onMain === true, 'tag commit is not on main'); // rule:on-main
}
export function verifyPreflight(e) {
  version(e.version);
  verifyMain(e.onMain);
  check(newer(e.version, e.latestVersion), `version ${e.version} is not strictly newer than latest ${e.latestVersion}`); // rule:newer
  check(e.releaseExists === false, 'release with that tag already exists before building'); // rule:exists
  check(/^[a-f0-9]{40}$/.test(e.tagSha), 'invalid tag commit');
  check(e.packageVersion === e.version, 'stale version in tagged desktop package.json'); // rule:package-version
  return e;
}
export function verifyTag(expected, actual) {
  check(expected === actual, `moved tag: expected ${expected}, now ${actual}`); // rule:moved-tag
}
export function verifyRun(run, tag, sha) {
  check(run?.headBranch === tag && run?.headSha === sha && run?.status === 'completed' && run?.conclusion === 'success', 'CI run is missing, unsuccessful, or builds the wrong tag/commit'); // rule:ci
  check(builtAllPlatforms(run), 'CI run did not successfully build every platform and pass checks'); // rule:ci-jobs
}
export function verifySmoke(s, sha, installerSha512) {
  check(s?.installed === true && s?.started === true && s?.exitCode === 0 && s?.sourceSha === sha && s?.installerSha512 === installerSha512,
    'Windows smoke test failed: installer did not install/start or evidence belongs to another build'); // rule:smoke
}
export function verifyInstaller(pkg, main, sha, v, origins = allowedOrigins, requireAccountOrigin = false) {
  check(pkg.version === v, 'stale version in extracted installer'); // rule:installer-version
  check(pkg.sourceSha === sha, `sourceSha mismatch in extracted installer: ${pkg.sourceSha}, tag ${sha}`); // rule:source-sha
  check(!requireAccountOrigin || (typeof pkg.accountOrigin === 'string' && pkg.accountOrigin.length > 0), 'accountOrigin is required for this release'); // rule:required-origin
  check(pkg.accountOrigin === undefined || origins.includes(pkg.accountOrigin), `accountOrigin is not allowed: ${pkg.accountOrigin}`); // rule:origin
  // Check the shipped runtime configuration, not electron-builder's publish configuration.
  check(/^\s*updater\.allowDowngrade\s*=\s*false\s*;/m.test(main) && !/^\s*updater\.allowDowngrade\s*=\s*true/m.test(main), 'updater config must explicitly set allowDowngrade: false'); // rule:downgrade
}
export function verifyAssets(v, assets, documents) {
  for (const name of expectedAssets(v)) {
    check(Object.hasOwn(assets, name), `missing named asset: ${name}`); // rule:named-assets
  }
  for (const name of Object.keys(assets)) {
    check(!/\d+\.\d+\.\d+/.test(name) || name.match(/\d+\.\d+\.\d+/)[0] === v, `stale version file: ${name}`); // rule:stale-file
  }
  for (const name of new Set([...manifests, ...Object.keys(documents)])) {
    const doc = documents[name];
    check(doc && doc.version === v, `${name}: stale or missing manifest version`); // rule:manifest-version
    check(Array.isArray(doc.files) && doc.files.length > 0 && typeof doc.path === 'string', `${name}: missing files/path`);
    const reference = file => {
      check(typeof file === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file) && !file.includes('..'), `${name}: url/path must be a bare file name: ${file}`); // rule:bare-name
      check(Object.hasOwn(assets, file), `${name}: url/path is not in upload set: ${file}`); // rule:upload-set
      return assets[file];
    };
    // Visit all url/path keys, including future nested manifest fields.
    const visit = obj => {
      if (!obj || typeof obj !== 'object') return;
      for (const [key, val] of Object.entries(obj)) {
        if (key === 'url' || key === 'path') reference(val);
        else visit(val);
      }
    };
    visit(doc);
    for (const entry of doc.files) {
      const asset = reference(entry.url);
      check(entry.sha512 === asset.sha512, `${name}: wrong sha512 for ${entry.url}`); // rule:sha512
      check(Number.isSafeInteger(entry.size) && entry.size === asset.size, `${name}: wrong size for ${entry.url}`); // rule:size
    }
    const legacy = reference(doc.path);
    check(doc.sha512 === legacy.sha512, `${name}: wrong sha512 for path ${doc.path}`); // rule:legacy-sha512
    if (doc.size !== undefined) check(doc.size === legacy.size, `${name}: wrong size for path ${doc.path}`); // rule:legacy-size
  }
}
export function verifyFixture(e, policy = {}) {
  verifyPreflight(e.preflight);
  verifyTag(e.preflight.tagSha, e.tagSha);
  verifyRun(e.run, `v${e.preflight.version}`, e.tagSha);
  verifyAssets(e.preflight.version, e.assets, e.manifests);
  verifyInstaller(e.installer, e.main, e.tagSha, e.preflight.version, policy.origins, policy.requireAccountOrigin);
  verifySmoke(e.smoke, e.tagSha, e.assets[`Filow-${e.preflight.version}-win-x64.exe`].sha512);
}

// IO boundary. Every child has a hard deadline; there are no GitHub write calls here.
export function command(exe, args, timeout = 120_000) {
  return execFileSync(exe, args, { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
}
const gh = args => JSON.parse(command('gh', args));
const api = route => gh(['api', route]);
export function remoteTag(v) { return api(`repos/${sourceRepo}/commits/v${v}`).sha; }
export function currentLatest() { return api(`repos/${feedRepo}/releases/latest`).tag_name.replace(/^v/, ''); }
export function collectPreflight(v, commit) {
  const tagSha = commit ? api(`repos/${sourceRepo}/commits/${commit}`).sha : remoteTag(v);
  const comparison = api(`repos/${sourceRepo}/compare/${tagSha}...main`);
  // A failed request (including authentication/rate limit failures) is never interpreted as absence.
  const releases = repo => JSON.parse(command('gh', ['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`])).flat();
  const pkg = api(`repos/${sourceRepo}/contents/apps/desktop/package.json?ref=${tagSha}`);
  return verifyPreflight({ version: v, tagSha, onMain: ['ahead', 'identical'].includes(comparison.status),
    latestVersion: currentLatest(), releaseExists: [sourceRepo, feedRepo].some(r => releases(r).some(x => x.tag_name === `v${v}`)),
    packageVersion: JSON.parse(Buffer.from(pkg.content, 'base64').toString()).version });
}
export async function digest(file) {
  const hash = createHash('sha512');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return { sha512: hash.digest('base64'), size: fs.statSync(file).size };
}
export async function loadAssets(dir, v) {
  const assets = {}, documents = {};
  for (const file of fs.readdirSync(dir)) {
    if (!fs.statSync(path.join(dir, file)).isFile()) continue;
    if (file === 'builder-debug.yml' || file === 'smoke-result.json') continue;
    assets[file] = await digest(path.join(dir, file));
    if (/^latest.*\.yml$/.test(file)) documents[file] = yaml.load(fs.readFileSync(path.join(dir, file), 'utf8'));
  }
  verifyAssets(v, assets, documents);
  return assets;
}
export function extractInstaller(installer, work) {
  check(!fs.existsSync(work), `extraction directory already exists: ${work}`);
  fs.mkdirSync(work, { recursive: true });
  const seven = process.env.FILOW_RELEASE_7Z || '7z';
  command(seven, ['x', installer, `-o${work}`, '-y', '$PLUGINSDIR/app-64.7z'], 180_000);
  const payload = path.join(work, '$PLUGINSDIR', 'app-64.7z');
  check(fs.existsSync(payload), 'installer has no x64 payload');
  command(seven, ['x', payload, `-o${path.join(work, 'app')}`, '-y', 'resources/app.asar'], 180_000);
  const asar = require('@electron/asar');
  const archive = path.join(work, 'app', 'resources', 'app.asar');
  return { pkg: JSON.parse(asar.extractFile(archive, 'package.json').toString()), main: asar.extractFile(archive, 'main.js').toString() };
}
export async function verifyPublished({ version: v, dir, work, state, audit = false, phase, origins, requireAccountOrigin }) {
  const sha = remoteTag(v);
  const comparison = api(`repos/${sourceRepo}/compare/${sha}...main`);
  verifyMain(['ahead', 'identical'].includes(comparison.status));
  if (!audit) {
    verifyPreflight(state);
    check(state.version === v, 'preflight version differs from requested version');
    verifyTag(state.tagSha, sha);
    check(newer(v, currentLatest()), 'version is no longer newer than the feed Latest');
  }
  const runs = gh(['run', 'list', '-R', sourceRepo, '--workflow', 'desktop.yml', '--branch', `v${v}`, '--limit', '100', '--json', 'databaseId,headBranch,headSha,status,conclusion']);
  const run = runs.find(r => {
    if (r.headSha !== sha || r.status !== 'completed' || r.conclusion !== 'success') return false;
    r.jobs = gh(['run', 'view', String(r.databaseId), '-R', sourceRepo, '--json', 'jobs']).jobs;
    return builtAllPlatforms(r);
  });
  verifyRun(run, `v${v}`, sha);
  const assets = await loadAssets(dir, v);
  const installer = extractInstaller(path.join(dir, `Filow-${v}-win-x64.exe`), work);
  // Audit all extracted properties even when an older release fails one of the new rules.
  console.log(JSON.stringify({ version: v, tagSha: sha, run: run.databaseId, assets: Object.keys(assets).length,
    installer: { version: installer.pkg.version, sourceSha: installer.pkg.sourceSha, accountOrigin: installer.pkg.accountOrigin ?? null }, explicitAllowDowngradeFalse: /^\s*updater\.allowDowngrade\s*=\s*false\s*;/m.test(installer.main) }, null, 2));
  verifyInstaller(installer.pkg, installer.main, sha, v, origins, requireAccountOrigin);
  if (!audit && phase !== 'draft') verifySmoke(JSON.parse(fs.readFileSync(path.join(dir, 'smoke-result.json'), 'utf8')), sha, assets[`Filow-${v}-win-x64.exe`].sha512);
  return { sha, assets, audit };
}
// An explicit live-release policy, never inferred from credentials or environment.
// The option takes a comma-separated list of exact production HTTPS origins.
export function accountOriginPolicy(value) {
  if (value === undefined) return {};
  const origins = value.split(',');
  check(origins.length > 0 && origins.every(origin => {
    try { const u = new URL(origin); return u.protocol === 'https:' && u.origin === origin; }
    catch { return false; }
  }), '--require-account-origin needs exact HTTPS origins separated by commas');
  return { origins, requireAccountOrigin: true };
}
async function cli(args) {
  const [mode, ...rest] = args;
  check(rest.length % 2 === 0 && rest.every((v, i) => i % 2 ? !v.startsWith('--') : v.startsWith('--')), 'Options require a value');
  const opts = Object.fromEntries(rest.reduce((out, value, i) => i % 2 ? out : [...out, [value.replace(/^--/, ''), rest[i + 1]]], []));
  const policy = accountOriginPolicy(opts['require-account-origin']);
  if (mode === 'fixture') verifyFixture(JSON.parse(fs.readFileSync(opts.input, 'utf8')), policy);
  else if (mode === 'preflight') fs.writeFileSync(opts.state, JSON.stringify(collectPreflight(opts.version, opts.commit), null, 2), { flag: 'wx' });
  else if (mode === 'verify' || mode === 'audit') await verifyPublished({ ...opts, ...policy, audit: mode === 'audit', state: mode === 'verify' ? JSON.parse(fs.readFileSync(opts.state, 'utf8')) : undefined });
  else throw new Error('Usage: release-verify.mjs preflight --version V --state FILE | verify --version V --state FILE --dir ASSETS --work NEWDIR | audit --version V --dir ASSETS --work NEWDIR | fixture --input FILE [--require-account-origin https://production.example,https://other.example]');
  console.log(mode === 'audit' ? 'PASS: historical audit (prebuild absence, newer version and smoke not asserted)' : 'PASS: release verification');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).catch(error => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
}
