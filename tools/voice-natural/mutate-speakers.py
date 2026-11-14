"""Assertion-based mutations for automatic speaker selection, restoring exact bytes."""
import pathlib
import subprocess
import sys

tests = ['apps/desktop/tts.test.ts', 'apps/desktop/okfilow.test.ts', 'apps/web/components/voiceSettings.test.tsx']
changes = [
    ('wrong-recommendation', 'apps/desktop/tts.js', '{ en: 9, it: 9', '{ en: 0, it: 9'),
    ('lose-explicit-zero', 'apps/desktop/tts.js', 'n >= 0 && n < VOICES', 'n > 0 && n < VOICES'),
    ('lose-auto-setting', 'apps/desktop/okfilow.js', 'Math.max(-1, Math.round(speaker))', 'Math.max(0, Math.round(speaker))'),
    ('unset-ui-default', 'apps/web/app/okfilow/panel/voice-settings.tsx', 'status.naturalVoice ?? -1', 'status.naturalVoice ?? 0'),
]

def check(name):
    return subprocess.run([sys.executable, 'tools/voice-natural/run.py', '60', name+'.log',
        'node', 'node_modules/vitest/vitest.mjs', 'run', *tests, '--maxWorkers=1'], timeout=85)

if check('speaker-mutation-baseline').returncode:
    raise SystemExit('Clean baseline failed')
for name, filename, before, after in changes:
    target = pathlib.Path(filename)
    original = target.read_bytes()
    source = original.decode('utf-8')
    try:
        if source.count(before) != 1:
            raise RuntimeError('Ambiguous mutation: '+name)
        target.write_text(source.replace(before, after), encoding='utf-8')
        result = check('mutation-'+name)
        log = pathlib.Path('G:/FILOW/tmp/voice-natural/mutation-'+name+'.log').read_text(encoding='utf-8')
        if result.returncode != 1 or 'AssertionError' not in log:
            raise RuntimeError('Mutation not killed by assertion: '+name)
        print('KILLED', name, flush=True)
    finally:
        target.write_bytes(original)
