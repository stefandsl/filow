import fs from 'node:fs';
import path from 'node:path';
import { ensure, hash, json, read } from './worktree.mjs';

const levels = ['Light', 'Medium', 'Heavy'];
export function editGrant(card) {
  return { paths: [...new Set([...(card.paths || []), 'docs/REVIEW.md'])], appendOnly: ['docs/REVIEW.md'] };
}
export function parse(args) {
  const [verb, ...rest] = args;
  ensure(['plan', 'build', 'verify'].includes(verb), 'Choose filow:plan, filow:build or filow:verify.');
  const options = {};
  const positionals = [];
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i];
    if (!name.startsWith('-')) { positionals.push(name); continue; }
    ensure(!(name in options), 'Duplicate factory option.');
    if (['--dry-run', '--retry', '--new-round'].includes(name)) options[name] = true;
    else {
      ensure(['--card', '--candidate'].includes(name) && rest[i + 1] && !rest[i + 1].startsWith('-'), 'Unknown option or missing option value.');
      options[name] = rest[++i];
    }
  }
  ensure(positionals.length === 1, 'Supply one ticket or run ID. Quote a plain-language plan request.');
  ensure(!options['--card'] || verb === 'plan', '--card belongs to plan.');
  ensure((!options['--candidate'] && !options['--new-round']) || verb === 'verify', 'Candidate and review round options belong to verify.');
  ensure(!options['--candidate'] || /^[0-9a-f]{40}$/.test(options['--candidate']), 'Use the full candidate SHA.');
  ensure(!options['--retry'] || verb !== 'plan', 'Retry a failed build or verify.');
  return { verb, target: positionals[0], dry: !!options['--dry-run'], retry: !!options['--retry'],
    newRound: !!options['--new-round'], candidate: options['--candidate'], card: options['--card'] };
}

export function stakes(description, files = [], diff = '', floor = 'Light') {
  const signal = [description, ...files, diff].join('\n');
  const heavy = /consent|consenso|permission|refus(?:e|al)|provider|https?:\/\/|\bipc\b|migration|installer|billing|payment|external write|network destination|unknown boundary|\.github\/workflows/i;
  let level = 'Medium', reason = 'Feature or reversible local behavior.';
  if (heavy.test(signal)) { level = 'Heavy'; reason = 'Consent, external destination or system boundary.'; }
  else if (files.length ? files.every(f => /\.md$|\.css$/.test(f)) : /typo|spelling|layout|documentation/i.test(description)) {
    level = 'Light'; reason = 'Copy, layout or documentation.';
  } else if (!files.length && !/feature|local|task|restart/i.test(description)) { level = 'Heavy'; reason = 'Unknown boundary.'; }
  return levels.indexOf(floor) > levels.indexOf(level) ? { level: floor, reason: 'Frozen plan requires this level.' } : { level, reason };
}
export function safeText(value) {
  ensure(typeof value === 'string' && value.trim() && value.length < 12000 && !Array.from(value).some(c => c.charCodeAt(0) < 9), 'Invalid or empty card or evidence field.');
  const secrets = Object.entries(process.env).filter(([k,v]) => /token|password|secret|api_key/i.test(k) && v.length >= 8);
  ensure(!secrets.some(([,v]) => value.includes(v)) && !/(?:sk-(?:proj-|ant-)?[\w-]{12,}|gh[pousr]_[\w]{12,}|-----BEGIN .*PRIVATE KEY-----)/i.test(value),
    'Sensitive material detected. Supply sanitized ticket data.');
  return value;
}
export function ticketCard(root, target, file) {
  safeText(target);
  const practice = json(path.join(root, 'tools/factory/N-08-PRACTICE.json'));
  const plan = read(path.join(root, 'docs/PLAN.md'));
  const sections = [...plan.matchAll(/^### ([NXL]-\d+) ([^\r\n]+)\r?\n([\s\S]*?)(?=\r?\n#|(?![\s\S]))/gm)];
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const match = sections.filter(m => m[1] === target || normalize(m[2]).includes(normalize(target)));
  const isPractice = target === practice.ticket || /save practice|practice (?:button|tour|ticket)/i.test(target);
  ensure(isPractice || match.length <= 1 && (match.length || !/^[NXL]-\d/.test(target)), 'No unique plan ticket. Use an existing ID or describe the new request.');
  const requestId = 'REQUEST-' + hash(target).slice(0,10).toUpperCase();
  const ticket = isPractice ? practice.ticket : match[0]?.[1] || (/^REQUEST-[0-9A-F]{10}$/.test(target) ? target : requestId);
  const card = file ? packetReply(file) : isPractice ? practice : null;
  if (!card) return { ticket, goal: match[0]?.[2] || target, text: match[0]?.[3].trim() || target };
  ensure(/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(card.ticket) && (!ticket || ticket === card.ticket), 'Card ticket does not match the request.');
  for (const key of ['goal', 'initial', 'action', 'positive', 'negative', 'reason']) safeText(card[key]);
  ensure(levels.includes(card.stakes), 'Card stakes must be Light, Medium or Heavy.');
  for (const key of ['checks', 'paths', 'callers']) {
    ensure(Array.isArray(card[key]) && card[key].length > 0, 'List the checks, callers and exact writable files on the card.');
    for (const value of card[key]) {
      safeText(value);
      if (key !== 'checks') {
        const parts = value.split('/');
        if (key === 'callers' && parts[0] === '.github') parts.shift();
        ensure(/^[\w.@-]+(?:\/[\w.@-]+)*$/.test(value) && parts.length &&
          !parts.some(p => p === '.' || p === '..' || /^\.(git|env)/i.test(p)), 'Use literal repository file paths on the card.');
      }
    }
  }
  ensure(card.callers.every(f => fs.existsSync(path.join(root, f))), 'A frozen caller is missing from this checkout.');
  if (card.bugFix !== undefined) ensure(typeof card.bugFix === 'boolean', 'Set bugFix to true or false.');
  return Object.fromEntries(['ticket','goal','initial','action','positive','negative','reason','stakes','checks','paths','callers','bugFix'].map(k => [k,card[k]]));
}

export function packetReply(file, contents = read(file)) {
  const text = contents.trim();
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(text);
  const reason = 'Expected one JSON object in ' + file + '. Remove surrounding prose or extra fences.';
  let reply;
  try { reply = JSON.parse(fenced ? fenced[1] : text); }
  catch { ensure(false, reason); }
  ensure(reply && typeof reply === 'object' && !Array.isArray(reply), reason);
  return reply;
}
