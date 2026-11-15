"""Run original spike training on identical app enrolment WAVs, fixed seed.

Historical spike thresholds are reproduced for diagnosis only: they use its
evaluation background and must not be presented as held-out calibration.
"""
import importlib
import json
import sys
from pathlib import Path
import numpy as np
source, fixtures, reference, output = map(Path, sys.argv[1:5])
sys.path.insert(0, str(source))
import wk
T = importlib.import_module('04b_template')
g = T.glob()
manifest = json.loads((fixtures / 'manifest.json').read_text())
load = wk.load
rows = []
for vi, voice in enumerate(manifest['voices']):
    mapping = {f'round1-{j}': Path(clip['file']) for j, clip in enumerate(voice['enrol'])}
    wk.load = lambda file: load(mapping.get(Path(file).stem, file))
    w, b = T.lr_train(list(mapping), seed=12345)
    neg = np.sort(-T.block_min(-T.lr_scores(w, b, g['ev'])))[::-1]
    thresholds = dict(loose=float(neg[int(5*g['hours'])]), sure=float(neg[int(.1*g['hours'])]), sensitive=float(neg[int(.5*g['hours'])]))
    profile = dict(weights=w.flatten().tolist(), bias=b, thresholds=thresholds)
    clips = []
    for kind in ('enrol', 'test', 'near'):
        for clip in voice[kind]:
            stem = Path(clip['file']).stem
            e = np.fromfile(reference / (stem + '.emb'), dtype='<f4').reshape(-1,96)
            clips.append(dict(stem=stem, kind=kind, score=float(T.lr_scores(w,b,e).max())))
    rows.append(dict(voice=voice['voice'], lang=voice['lang'], profile=profile, clips=clips))
    output.write_text(json.dumps(rows))
    print(vi, voice['voice'], voice['lang'], flush=True)
