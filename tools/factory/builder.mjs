import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getReport } from './review.mjs';
import { ensure, git, hash, Hold, json, operatorIdentity, read } from './worktree.mjs';
import { observeSlice } from './factory.mjs';
import { linkDependencies } from './gates.mjs';

function reusable(state, dir, copy, start) {
  try {
    const metadata = git(copy,'rev-parse','--absolute-git-dir');
    if (fs.realpathSync(metadata) !== fs.realpathSync(path.join(dir,'git-data')) ||
        git(copy,'branch','--show-current') !== state.branch || git(copy,'remote') ||
        git(copy,'status','--porcelain','--untracked-files=all')) return false;
    const stamp = path.join('node_modules','.filow-lock-sha256');
    if (fs.realpathSync(path.join(copy,stamp)) !== fs.realpathSync(path.join(state.root,stamp)) ||
        read(path.join(copy,stamp)) !== hash(fs.readFileSync(path.join(state.root,'package-lock.json')))) return false;
    const head = git(copy,'rev-parse','HEAD');
    if (head !== start) {
      if (git(copy,'merge-base',start,head) !== start) return false;
      observeSlice({root:copy,head},state);
    }
    return true;
  } catch (error) {
    if (error instanceof Hold || error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

export function builderCheckout(state, dir, start) {
  const copy = path.join(dir,'checkout');
  const identity = operatorIdentity(state.root);
  const metadata = path.join(dir,'git-data');
  if (fs.existsSync(copy) || fs.existsSync(metadata) || fs.existsSync(path.join(dir,'report.json'))) {
    if (reusable(state,dir,copy,start)) return copy;
    const backup = fs.mkdtempSync(path.join(dir,'old-'));
    for (const item of ['checkout','git-data','report.json']) {
      const from = path.join(dir,item);
      if (fs.existsSync(from)) fs.renameSync(from,path.join(backup,item));
    }
    const pointer = path.join(backup,'checkout','.git');
    if (fs.lstatSync(pointer,{throwIfNoEntry:false})?.isFile() && fs.existsSync(path.join(backup,'git-data'))) {
      fs.renameSync(pointer,pointer + '.original');
      fs.writeFileSync(pointer,'gitdir: ../git-data\n');
    }
    console.log('Preserved incomplete builder checkout at ' + backup);
  }
  fs.mkdirSync(dir,{recursive:true});
  // A private object database and index let the sandbox commit without write access to the primary clone.
  git(state.root,'clone','--quiet','--shared','--no-checkout','--config','core.longpaths=true','--separate-git-dir',path.join(dir,'git-data'),'--',state.root,copy);
  git(copy,'checkout','-q','-B',state.branch,start);
  git(copy,'remote','remove','origin');
  git(copy,'config','user.name',identity.GIT_AUTHOR_NAME);
  git(copy,'config','user.email',identity.GIT_AUTHOR_EMAIL);
  linkDependencies(state.root,copy);
  return copy;
}

export function builderResult(state,dir,report) {
  const root = path.join(dir,'checkout'), head = git(root,'rev-parse','HEAD');
  const where = "'" + root.replaceAll("'","''") + "'";
  const rerun = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '" + path.join(dir,'dispatch.ps1').replaceAll("'","''") + "'";
  ensure(!git(root,'status','--porcelain=v1','--untracked-files=all'),
    'Builder reply rejected with uncommitted changes. Inspect the private slice:\ngit -C ' + where + ' diff HEAD\ngit -C ' + where + ' status --short\nResume the builder to finish its slice:\n' + rerun);
  if (report?.verdict === 'HOLD') ensure(head === (state.repairPacketBase || state.base),
    'Builder HOLD includes a new commit. Inspect git -C ' + where + ' log -1\n' + rerun);
  ensure(report?.verdict !== 'HOLD','Builder HOLD: ' + (report?.observed || report?.candidateObservation) + '. After resolving the input, run ' + rerun);
  ensure(report?.verdict === 'COMMITTED' && report.candidate === head && head !== (state.repairPacketBase || state.base),
    'Builder reply needs the exact new candidate commit. Run ' + rerun);
  ensure(git(root,'branch','--show-current') === state.branch,'Builder left its assigned branch. Inspect git -C ' + where + ' status --short');
  try { observeSlice({root,head},state); }
  catch (error) {
    if (error instanceof Hold) throw new Hold(error.message + '\nResume the private builder:\n' + rerun);
    throw error;
  }
  return head;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [runFile,dir] = process.argv.slice(2);
    builderResult(json(runFile),dir,getReport(path.join(dir,'report.json')));
  } catch (error) {
    console.error('HOLD: ' + (error instanceof Hold ? error.message : 'Check the private builder checkout and reply.'));
    process.exitCode = 1;
  }
}
