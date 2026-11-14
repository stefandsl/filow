"""Generate a small independent regression fixture, no captured voice audio."""
import json, math, hashlib
from pathlib import Path
import numpy as np
source=Path(__file__).with_name('stage-reference.py').read_text()
scope={}
exec(source.split("app = json.loads")[0],scope)
x=np.array([0,.25,-.5,.75,-.25,0,.125,-.125]*80,dtype=np.float32)
rows=[]
for variant in range(4):
    y=scope['augment'](x,variant)
    e=scope['feats'].embed(y)
    rows.append(dict(variant=variant,samples=len(y),sha256=hashlib.sha256(y.tobytes()).hexdigest(),embedding=e[-1].tolist()))
dest=Path(__file__).resolve().parents[2]/'apps/desktop/wake-data/portable-reference.json'
import importlib
train=importlib.import_module('portable-trainer').train
positive=np.zeros((20,1152),np.float32);positive[:,0]=1
negative=np.zeros(3000*96,np.float32);negative[::96]=-1
_,_,snapshots=train(positive,negative,np.array([[0,1000]]))
optimizer=[dict(step=step,weights=snapshots[i,:8].tolist(),bias=float(snapshots[i,1152]),loss=float(snapshots[i,1153])) for i,step in enumerate([1,10,120000])]
dest.write_text(json.dumps(dict(seed=12345,pattern=[0,.25,-.5,.75,-.25,0,.125,-.125],repeats=80,rows=rows,optimizer=optimizer),indent=2)+'\n')
