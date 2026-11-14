"""Score independent languages on three CPU workers after synthesis timing is complete."""
import concurrent.futures
import subprocess
import sys

names=['baseline','baseline-repeat','whole','steps4','steps6','steps8','speed100','raw','full','piper','kokoro','pipeline']
names += ['speaker'+str(i) for i in range(1,10)]
def score(lang):
    return subprocess.run([sys.executable,'tools/voice-natural/run.py','1800','asr-parallel-'+lang+'.log',
        'node','tools/voice-natural/asr.cjs',lang,*names],timeout=1825).returncode
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    results=list(pool.map(score,['it','en','ru','ro','ja']))
if any(results):
    raise SystemExit(str(results))
