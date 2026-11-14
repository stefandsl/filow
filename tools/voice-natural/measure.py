"""Run after sweep.py has exited. No parallel CPU workloads in this coordinator."""
import subprocess
import sys

def run(seconds, log, *command):
    result = subprocess.run([sys.executable, 'tools/voice-natural/run.py', str(seconds), log, *command], timeout=seconds+25)
    if result.returncode:
        raise SystemExit(result.returncode)

for name, args in [('baseline-repeat', ['5','0','app']), ('steps6',['6','0','app']),
                   ('full',['5','0','app','full'])]:
    run(240, name+'.log','node','tools/voice-natural/bench.cjs',name,*args)
for family in ['piper','kokoro']:
    run(300,family+'.log','node','tools/voice-natural/candidates.cjs',family)
run(240,'pipeline.log','node','tools/voice-natural/worker-bench.cjs')
names=['baseline','baseline-repeat','whole','steps4','steps6','steps8','speed100','raw','full','piper','kokoro','pipeline']
names += ['speaker'+str(i) for i in range(1,10)]
run(1800,'analyse.log',sys.executable,'tools/voice-natural/analyse.py',*names)
for lang in ['it','en','ru','ro','ja']:
    run(1800,'asr-'+lang+'.log','node','tools/voice-natural/asr.cjs',lang,*names)
