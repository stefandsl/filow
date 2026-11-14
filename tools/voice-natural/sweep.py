"""Sequential synthesis keeps the benchmark's own variants from competing for CPU."""
import subprocess
import sys

variants = [('steps4', '4', '0', 'app'), ('steps8', '8', '0', 'app'),
            ('speed100', '5', '0', 'app', 'int8', '1'), ('raw', '5', '0', 'raw')]
variants += [('speaker' + str(i), '5', str(i), 'app') for i in range(1, 10)]
for args in variants:
    result = subprocess.run([sys.executable, 'tools/voice-natural/run.py', '240', args[0] + '.log',
                             'node', 'tools/voice-natural/bench.cjs', *args], timeout=265)
    if result.returncode:
        raise SystemExit(result.returncode)
