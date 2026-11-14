"""Real fifteen-spelling search, rather than the spike's per-spelling union."""
import json
import sys
from pathlib import Path
import numpy as np
import soundfile as sf
import sherpa_onnx as so
models, reference, output = map(Path, sys.argv[1:4])
kws = so.KeywordSpotter(tokens=str(models / 'tokens.txt'), encoder=str(models / 'encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx'), decoder=str(models / 'decoder-epoch-13-avg-2-chunk-16-left-64.onnx'), joiner=str(models / 'joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx'), keywords_file=str(models / 'keywords.txt'), num_threads=1, max_active_paths=16, keywords_score=2.5, keywords_threshold=.05, provider='cpu')
rows = []
for row in json.loads((reference / 'index.json').read_text()):
    x, sr = sf.read(row['file'], dtype='float32')
    assert sr == 16000
    x = np.concatenate([x, np.zeros((-len(x)) % 1600 + 32000, np.float32)])
    s = kws.create_stream()
    hits = []
    for at in range(0, len(x), 1600):
        s.accept_waveform(16000, x[at:at+1600])
        while kws.is_ready(s):
            kws.decode_stream(s)
            result = kws.get_result(s)
            if result:
                hits.append((at + 1600) / 16)
                kws.reset_stream(s)
    rows.append(dict(stem=row['stem'], hits=hits))
output.write_text(json.dumps(rows))
print('spotter reference clips', len(rows))
