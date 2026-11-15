"""Independent portable augmentation and spike embedding stage comparison.

This deliberately changes the spike augmentation reference. Its original
recorded speech/noise and pitch transforms are not the portable reference.
"""
import hashlib, json, math, sys
from pathlib import Path
import numpy as np
root = Path('G:/FILOW/tmp/wake-word/round3')/f'voice-{int(sys.argv[1]) if len(sys.argv)>1 else 0}'
sys.path.insert(0, 'G:/FILOW/tmp/wakeword-spike')
import feats
state = 12345
def random():
    global state
    state = (state * 1664525 + 1013904223) & 0xffffffff
    return state / 4294967296
def augment(x, variant):
    speed = [.94, 1, 1.06][variant % 3]
    gain = [1, .6, .35][variant % 3]
    n = math.ceil(len(x) / speed)
    audio = np.zeros(16000+n+9600, np.float32)
    power = 0.
    for i in range(n):
        pos = i*speed; left = math.floor(pos); frac = pos-left
        value = gain*((float(x[left]) if left < len(x) else 0)*(1-frac)+(float(x[left+1]) if left+1 < len(x) else 0)*frac)
        audio[16000+i] = value; power += value*value
    noise = math.sqrt(power/n*12)/math.pow(10,[20,15,10][variant%3]/20)
    if variant%4:
        for i in range(len(audio)): audio[i] = float(audio[i])+(random()-.5)*noise
    if variant%4 == 3:
        dry = audio.copy()
        for i in range(640,len(audio)): audio[i] = float(audio[i])+(.2*float(dry[i-640])+(.1*float(dry[i-1120]) if i>=1120 else 0))
    return audio
app = json.loads((root/'app-stages.json').read_text())
rows = []
positive = []
for row in app['rows']:
    x = np.fromfile(root/f"take-{row['take']}.f32", dtype='<f4')
    y = augment(x,row['variant'])
    checksum = hashlib.sha256(y.tobytes()).hexdigest()
    if checksum != row['sha256'] or len(y) != row['samples']:
        raise RuntimeError(f"First divergence: augmentation clip {row['id']}")
    e = feats.embed(y)
    expected = np.fromfile(root/f"embedding-{row['id']}.f32",dtype='<f4').reshape(-1,96)
    error = float(np.max(np.abs(e-expected)))
    rows.append(dict(id=row['id'],sha256=checksum,embeddingMaxError=error))
    e.astype('<f4').tofile(root/f"python-embedding-{row['id']}.f32")
    if error > 2e-6: raise RuntimeError(f"First divergence: embedding {row['id']}: {error}")
    # Calculate labels independently, never take the app's list as input.
    energy = [sum(float(v)*float(v) for v in x[i:i+320]) for i in range(0,len(x)-319,320)]
    end = next(((i+1)*320 for i in range(len(energy)-1,-1,-1) if energy[i]>max(energy)*.001),len(x))
    speed = [.94,1,1.06][row['variant']%3]
    indices = [math.ceil(((1+end/speed/16000+dt-.015)/.01-76)/8) for dt in [.08,.16,.24,.32]]
    indices = [i for i in indices if 11<=i<len(e)]
    if indices != row['indices']: raise RuntimeError('First divergence: positive labels')
    positive.extend([e[i-11:i+1].reshape(-1) for i in indices])
(root/'stage-reference.json').write_text(json.dumps(dict(referenceChanged=True,clips=len(rows),rows=rows),indent=2))
print('augmentation exact:',len(rows),'embedding max error:',max(r['embeddingMaxError'] for r in rows),flush=True)
import importlib
train=importlib.import_module('portable-trainer').train
data_dir=Path(__file__).resolve().parents[2]/'apps/desktop/wake-data'
meta=json.loads((data_dir/'background.json').read_text())
negative=(np.frombuffer((data_dir/'background.bin').read_bytes(),dtype=np.int8).astype(np.float64)/127).astype(np.float32)
negative_hash=hashlib.sha256(negative.tobytes()).hexdigest()
assert negative_hash==app['negative']['sha256']
ranges=[]; start=0
for segment in meta['segments']:
    ranges.append([start,start+segment['frames']//3]); start+=segment['frames']
w,b,snapshots=train(np.stack(positive),negative,np.array(ranges))
trace=[]
for index,step in enumerate([1,10,120000]):
    reference=snapshots[index]
    expected=app['trace'][index]
    trace.append(dict(step=step,sha256=hashlib.sha256(reference[:1152].astype('<f4').tobytes()).hexdigest(),loss=float(reference[1153]),weightMaxError=float(np.max(np.abs(reference[:1152]-expected['weights']))),biasError=abs(reference[1152]-expected['bias'])))
result=dict(referenceChanged=True,clips=len(rows),rows=rows,negativeSha256=negative_hash,positiveWindows=len(positive),window=12,hop=8,trace=trace)
(root/'stage-reference.json').write_text(json.dumps(result,indent=2))
print('optimizer',trace,flush=True)
assert max(t['weightMaxError'] for t in trace)<2e-5
scores=[]; start=0
for segment in meta['segments']:
    cut=start+segment['frames']//3; end=start+segment['frames']
    for at in range(cut,end-12-25+1,25):
        windows=np.stack([negative[(at+k)*96:(at+k+12)*96] for k in range(25)])
        scores.append(float(np.max(windows.astype(np.float64)@w.astype(np.float64)+b)))
    start=end
scores=sorted(scores,reverse=True); hours=len(scores)*2/3600
thresholds={name:scores[math.floor(budget*hours)] for name,budget in [('loose',5),('sensitive',.5),('sure',.1)]}
(root/'python-profile.json').write_text(json.dumps(dict(weights=w.tolist(),bias=b,thresholds=thresholds)))
