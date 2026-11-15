"""Export numerical near-miss windows from voices excluded from app QA."""
import hashlib
import json
import pickle
import sys
from pathlib import Path
import numpy as np
source, fixtures, dest = map(Path, sys.argv[1:4])
manifest = json.loads((fixtures / 'manifest.json').read_text())
excluded = {(v['voice'], v['lang']) for v in manifest['voices']}
idx = json.loads((source / 'out/posset_index.json').read_text(encoding='utf-8'))
emb = pickle.loads((source / 'out/emb/clips.pkl').read_bytes())
voices = []
for lang in ('en', 'it', 'ru', 'ro', 'ja'):
    voices.extend(sorted({(r['voice'], lang) for r in idx if r['lang'] == lang and r['kind'] == 'near' and (r['voice'], lang) not in excluded})[:2])
windows, clips = [], []
for i, row in enumerate(idx):
    if row['kind'] != 'near' or (row['voice'], row['lang']) not in voices:
        continue
    e = emb[i]
    # Include the entire phrase region, not the padded leading/trailing silence.
    for at in range(12, len(e) - 8, 4):
        windows.append(e[at-12:at].reshape(-1))
    clips.append({k: row[k] for k in ('id', 'voice', 'lang', 'text')})
data = np.stack(windows).astype('<f4').tobytes()
(dest / 'hard-negatives.bin').write_bytes(data)
(dest / 'hard-negatives.json').write_text(json.dumps(dict(version=1, dimensions=1152, windows=len(windows), sha256=hashlib.sha256(data).hexdigest(), source='Synthetic spike near-miss embeddings; no audio. Voices excluded from the 20-voice app QA corpus.', voices=voices, clips=clips), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('hard-negative windows', len(windows), 'voices', voices)
