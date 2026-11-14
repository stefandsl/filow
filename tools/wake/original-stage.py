"""Capture the unmodified spike's first augmentation stage, seed 12345."""
import json, sys, importlib, hashlib
from pathlib import Path
import numpy as np
sys.path.insert(0,'G:/FILOW/tmp/wakeword-spike')
import wk, feats
T=importlib.import_module('04b_template')
root=Path('G:/FILOW/tmp/wake-word')
voice=json.loads((root/'fixtures/manifest.json').read_text())['voices'][0]
mapping={f'round3-{i}':Path(c['file']) for i,c in enumerate(voice['enrol'])}
load=wk.load
wk.load=lambda file:load(mapping.get(Path(file).stem,file))
T.glob=lambda:dict(calwin=np.zeros((1,1152),np.float32))
rows=[]
class Finished(Exception): pass
def embed(audio):
    rows.append(dict(id=len(rows),samples=len(audio),seconds=len(audio)/16000,sha256=hashlib.sha256(audio.astype('<f4').tobytes()).hexdigest()))
    if len(rows)==80: raise Finished()
    return np.zeros((100,96),np.float32)
feats.embed=embed
try: T.lr_train(list(mapping),12345)
except Finished: pass
(root/'round3/original-spike-a.json').write_text(json.dumps(rows,indent=2))
app=json.loads((root/'round3/original-app-a.json').read_text())
print('counts',len(app),len(rows),'duration differences',sum(a['samples']!=b['samples'] for a,b in zip(app,rows)),'checksum differences',sum(a['sha256']!=b['sha256'] for a,b in zip(app,rows)),flush=True)
