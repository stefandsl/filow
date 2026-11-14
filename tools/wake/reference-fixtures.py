"""Small numerical fixtures from the unmodified spike (no audio shipped)."""
import sys
import json
from pathlib import Path
import numpy as np
sys.path.insert(0, sys.argv[1])
import feats

state = 7
pcm = []
for i in range(480 + 1280 * 30):
    state = (1664525 * state + 1013904223) & 0xffffffff
    pcm.append(0 if i < 14000 else ((state >> 16) - 32768) / 32768 * (0.03 if i < 26000 else 0.4))
x = np.array(pcm, np.float32)
rows = []
for blocks in (22, 26, 30):
    n = 480 + blocks * 1280
    e = feats.embed(x[:n])[-12:]
    rows.append(dict(samples=n, vectors=e.flatten().tolist()))
Path(sys.argv[2]).write_text(json.dumps(dict(seed=7, reference='Unmodified spike feats.embed, one thread; deterministic PCM recipe in wake-head.test.ts', rows=rows), separators=(',', ':')) + '\n')
