"""Sequential native-language recognizers, all outputs under G:."""
import subprocess
import sys

for lang in ['it', 'ru', 'ro', 'en', 'ja']:
    for mode in ['before', 'after']:
        subprocess.run([sys.executable, 'tools/voice-natural/run.py', '360',
                        f'round2-asr-numbers-{mode}-{lang}.log', 'node',
                        'tools/voice-natural/round2-asr.cjs', mode, 'numbers', lang],
                       check=True, timeout=390)
        print(mode, lang, 'done', flush=True)
