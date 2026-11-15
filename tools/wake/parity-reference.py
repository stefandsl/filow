"""Read-only spike reference on the app's exact PCM WAVs. All outputs on G:."""
import json
import sys
from pathlib import Path
import numpy as np

source, fixtures, dest = map(Path, sys.argv[1:4])
sys.path.insert(0, str(source))
import feats
import wk

dest.mkdir(parents=True, exist_ok=True)
manifest = json.loads((fixtures / 'manifest.json').read_text())
rows = []
mel, _ = feats._sess()
for voice in manifest['voices']:
    for kind in ('enrol', 'test', 'near'):
        for clip in voice[kind]:
            file = Path(clip['file'])
            x = wk.load(file)
            spec = np.squeeze(mel.run(None, {'input': (x[None, :] * 32767).astype(np.float32)})[0], axis=(0, 1)) / 10 + 2
            e = feats.embed(x)
            stem = file.stem
            spec.astype('<f4').tofile(dest / (stem + '.mel'))
            e.astype('<f4').tofile(dest / (stem + '.emb'))
            rows.append(dict(file=str(file), stem=stem, kind=kind, voice=voice['voice'], lang=voice['lang'], frames=len(e)))
(dest / 'index.json').write_text(json.dumps(rows))
print('reference clips', len(rows), flush=True)
