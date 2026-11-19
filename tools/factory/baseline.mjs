import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { childEnv, git, hash, now } from './worktree.mjs';

const auditRef = 'refs/heads/audit/fixes-0.9.42';

// Only the operator contacts origin. Remote URLs, credentials and Git stderr stay out of packets.
export function baselineInputs(root, bundle = process.env.FILOW_FACTORY_BRANCH_BUNDLE) {
  const missing = [];
  const auth = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(?:HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|XDG_CONFIG_HOME|SSH_AUTH_SOCK|GIT_SSH(?:_COMMAND)?|GIT_ASKPASS|GIT_CONFIG_(?:GLOBAL|SYSTEM)|GCM_CREDENTIAL_STORE|TMP|TEMP)$/i.test(key)));
  const query = spawnSync('git',['ls-remote','--exit-code','origin','refs/heads/main'],{
    cwd:root, encoding:'utf8', windowsHide:true, timeout:30000, stdio:['ignore','pipe','ignore'],
    env:{...childEnv(),...auth,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'},
  });
  const remote = query.status === 0 && /^([a-f0-9]{40})\s+refs\/heads\/main\s*$/.exec(query.stdout)?.[1] || null;
  if (!remote) missing.push('origin refs/heads/main (run git ls-remote origin refs/heads/main from the primary clone)');
  let bundleSha256 = null, archive = null, heads = 0;
  if (bundle && path.isAbsolute(bundle) && fs.existsSync(bundle)) {
    try {
      git(root,'bundle','verify',bundle);
      const advertised = git(root,'bundle','list-heads',bundle).split('\n');
      archive = advertised.find(line=>line.trimEnd().endsWith(' ' + auditRef))?.slice(0,40) || null;
      heads = advertised.length;
      bundleSha256 = hash(fs.readFileSync(bundle));
    } catch { /* Preserve both missing inputs in the operator diagnostic. */ }
  }
  if (!bundleSha256) missing.push('original branch bundle (set FILOW_FACTORY_BRANCH_BUNDLE to its absolute path)');
  if (!archive) missing.push('archived ' + auditRef + ' in the original bundle');
  return {observed:now(),remote,bundle:bundleSha256 ? bundle : null,bundleSha256,heads,auditRef,archive,missing};
}
