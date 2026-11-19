import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import { desktopCodex, writeDispatch } from '../factory/brief.mjs';
import { ensure, hash, json, read } from '../factory/worktree.mjs';

const schema = path.join(import.meta.dirname, 'replay.schema.json');

export function prepareReplay(folder, brief, resolveCodex = desktopCodex) {
  const exe = resolveCodex();
  ensure(exe, 'The bundled desktop Codex CLI is required.');
  ensure(!fs.existsSync(path.join(folder, 'report.json')), 'Preserve the previous receipt and use a fresh output folder.');
  return writeDispatch({ exe, role: 'Release reviewer',
    model: { provider:'Anthropic', model:'anthropic/claude-opus-5.5', via:'OpenRouter', effort:'high' }, cwd: folder, folder, brief,
    output: path.join(folder, 'report.json'), schema });
}

export function verifyReplay(file, assignment, candidate, blindFile, sealedDigest) {
  ensure(/^[a-f0-9]{40}$/.test(candidate) && /^[a-f0-9]{64}$/i.test(sealedDigest) &&
    hash(fs.readFileSync(blindFile)) === sealedDigest.toLowerCase(), 'Invalid candidate or changed blind case.');
  const report = json(file);
  const validate = new Ajv().compile(json(schema));
  ensure(validate(report), 'Invalid release receipt: ' + JSON.stringify(validate.errors));
  ensure(report.assignment === assignment && report.candidate === candidate && report.blindDigest === sealedDigest,
    'Release review belongs to another assignment, candidate or blind case.');
  ensure(report.verdict === 'PASS' && report.findings.length === 0 && report.missingEvidence.length === 0,
    'Independent review is on HOLD. Inspect the private receipt at ' + file);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [action, folderArg, ...args] = process.argv.slice(2);
  const folder = path.resolve(folderArg);
  if (action === 'prepare' && !args.length) {
    prepareReplay(folder, path.join(folder, 'brief.md'));
  } else if (action === 'verify' && args.length === 4) {
    const [assignment, candidate, blindFile, sealFile] = args;
    verifyReplay(path.join(folder, 'report.json'), assignment, candidate, blindFile, read(sealFile).trim());
    console.log('Independent release review passed.');
  } else throw new Error('Use prepare <folder> or verify <folder> <assignment> <candidate> <blind-file> <seal-file>.');
}
