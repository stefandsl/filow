"""Temporary targeted mutations; always restore the user's current source bytes."""
import pathlib
import subprocess
import sys

target = pathlib.Path('apps/web/lib/buddy/progressive.ts')
original = target.read_bytes()
source = original.decode('utf-8')
changes = [
    ('disable-batching', 'at !== firstBase && waiting.length', 'false && waiting.length'),
    ('enlarge-first', 'at !== firstBase && waiting.length', 'waiting.length'),
    ('lose-resume-count', 'current = { text, at, count: sentences };', 'current = { text, at, count };'),
    ('truncate-long-answer', 'text.length + 1 + waiting[0].text.length <= 4000', 'true'),
]
baseline = subprocess.run([sys.executable, 'tools/voice-natural/run.py', '60', 'mutation-baseline.log',
    'node', 'node_modules/vitest/vitest.mjs', 'run', 'apps/web/lib/buddy/progressive.batch.test.ts', '--maxWorkers=1'],timeout=85)
if baseline.returncode:
    raise SystemExit('Unmodified baseline must pass before mutations')
try:
    for name, before, after in changes:
        if source.count(before) != 1:
            raise RuntimeError('Mutation target is ambiguous: ' + name)
        target.write_text(source.replace(before, after), encoding='utf-8')
        result = subprocess.run([sys.executable, 'tools/voice-natural/run.py', '60', 'mutation-'+name+'.log',
            'node', 'node_modules/vitest/vitest.mjs', 'run', 'apps/web/lib/buddy/progressive.batch.test.ts', '--maxWorkers=1'],timeout=85)
        if result.returncode != 1:
            raise RuntimeError('Mutation was not killed by an assertion: ' + name)
        log = pathlib.Path('G:/FILOW/tmp/voice-natural/mutation-'+name+'.log').read_text(encoding='utf-8')
        if 'AssertionError' not in log:
            raise RuntimeError('Mutation failed for an unrelated reason: ' + name)
        print('KILLED',name,flush=True)
finally:
    target.write_bytes(original)
