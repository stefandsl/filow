import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getReport } from './review.mjs';
import { ensure, git, Hold, json } from './worktree.mjs';
import { observeSlice } from './factory.mjs';
import { linkDependencies } from './gates.mjs';

export function builderCheckout(state, dir, start) {
  const copy = path.join(dir,'checkout');
  if (fs.existsSync(path.join(copy,'.git'))) return copy;
  fs.mkdirSync(dir,{recursive:true});
  // A private object database and index let the sandbox commit without write access to the primary clone.
  git(state.root,'clone','--quiet','--shared','--no-checkout','--config','core.longpaths=true','--separate-git-dir',path.join(dir,'git-data'),'--',state.root,copy);
  git(copy,'checkout','-q','-B',state.branch,start);
  git(copy,'remote','remove','origin');
  const identity = /^(.*) <([^>]+)> /.exec(git(state.root,'var','GIT_AUTHOR_IDENT'));
  ensure(identity,'Configure a Git author in the primary clone and repeat build.');
  git(copy,'config','user.name',identity[1]);
  git(copy,'config','user.email',identity[2]);
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
