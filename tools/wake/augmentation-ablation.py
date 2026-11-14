"""Only replace positive augmentation; retain the Python solver/background/rules."""
import importlib
import json
import sys
from pathlib import Path
import numpy as np
from sklearn.linear_model import LogisticRegression
source, root = map(Path, sys.argv[1:3])
sys.path.insert(0,str(source))
T=importlib.import_module('04b_template')
g=T.glob()
reference=root/'round1-reference'
original=json.loads((root/'training-reference.json').read_text())
kws={r['stem']: bool(r['hits']) for r in json.loads((root/'spotter-reference.json').read_text())}
result=[]
for i,row in enumerate(json.loads((reference/'app-augmentation.json').read_text())):
    X=np.fromfile(reference/row['file'],dtype='<f4').reshape(-1,1152)
    Xa=np.concatenate([X,g['calwin']])
    ya=np.concatenate([np.ones(len(X)),np.zeros(len(g['calwin']))])
    m=LogisticRegression(C=1.,class_weight='balanced',max_iter=300).fit(Xa,ya)
    w=m.coef_.reshape(12,96).astype(np.float32)
    b=float(m.intercept_[0])
    neg=np.sort(-T.block_min(-T.lr_scores(w,b,g['ev'])))[::-1]
    loose=float(neg[int(5*g['hours'])]); sure=float(neg[int(.1*g['hours'])])
    clips=[]
    for clip in original[i]['clips']:
        e=np.fromfile(reference/(clip['stem']+'.emb'),dtype='<f4').reshape(-1,96)
        score=float(T.lr_scores(w,b,e).max())
        clips.append(dict(stem=clip['stem'],kind=clip['kind'],score=score,fired=score>sure or (kws[clip['stem']] and score>loose)))
    result.append(dict(voice=row['voice'],lang=row['lang'],clips=clips))
    (root/'augmentation-ablation.json').write_text(json.dumps(result))
    print(i,row['voice'],flush=True)
