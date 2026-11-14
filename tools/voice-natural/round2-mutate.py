"""Targeted mutations. Always restore the exact starting bytes; no commits here."""
import pathlib
import subprocess
import sys

root = pathlib.Path('G:/FILOW/tmp/voice-natural')
tests = ['apps/desktop/tts-round2.test.ts', 'apps/desktop/tts.test.ts',
         'apps/web/lib/buddy/progressive.batch.test.ts', 'apps/web/lib/buddy/voice.test.ts',
         'apps/web/lib/buddy/voice-pause.test.ts']

def run(name):
    result = subprocess.run([sys.executable, 'tools/voice-natural/run.py', '120', name + '.log',
                             'node', 'node_modules/vitest/vitest.mjs', 'run', *tests, '--maxWorkers=2'], timeout=150)
    return result.returncode, (root / (name + '.log')).read_text(encoding='utf-8')

if run('round2-mutation-baseline')[0]:
    raise SystemExit('Baseline must pass')
changes = [
    ('speaker', 'apps/desktop/tts.js', 'en: 5, it: 0, ru: 0, ro: 9, ja: 0', 'en: 9, it: 9, ru: 2, ro: 2, ja: 4'),
    ('span-language', 'apps/desktop/tts-spans.js', "const chosen = foreign ? 'en' : lang;", "const chosen = foreign ? lang : lang;"),
    ('span-speaker', 'apps/desktop/tts.js', 'lang: piece.lang, sid, speed, steps', 'lang: piece.lang, sid: 0, speed, steps'),
    ('numbers', 'apps/desktop/tts-numbers.js', 'let s = text;', 'return text; let s = text;'),
    ('tail-padding', 'apps/desktop/tts-audio.js', 'Math.round(rate * 0.08)', '0'),
    ('tail-fade', 'apps/desktop/tts-audio.js', '(fade-i-1)/fade', '1'),
    ('crossfade', 'apps/desktop/tts-spans.js', 'const mix = (i + 1) / (n + 1);', 'const mix = 1;'),
    ('dead-air', 'apps/web/lib/buddy/progressive.ts', 'at !== firstBase && waiting.length', 'false && waiting.length'),
    ('headroom', 'apps/web/lib/buddy/voice.ts', 'Math.min(120, p.leadMs ?? 30)', 'Math.min(30, p.leadMs ?? 30)'),
    ('currency-span', 'apps/desktop/tts-spans.js', '!currency && (ENGLISH.has', '(currency || !currency) && (ENGLISH.has'),
]
for name, filename, before, after in changes:
    target = pathlib.Path(filename)
    original = target.read_bytes()
    text = original.decode('utf-8')
    if text.count(before) != 1:
        raise SystemExit('Ambiguous mutation: ' + name)
    try:
        target.write_text(text.replace(before, after), encoding='utf-8')
        code, log = run('round2-mutation-' + name)
        if code != 1 or 'AssertionError' not in log:
            raise SystemExit('Mutation did not fail an assertion: ' + name)
        print('KILLED', name, flush=True)
    finally:
        target.write_bytes(original)
