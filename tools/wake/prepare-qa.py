"""Export existing synthetic fixtures without changing the spike. No microphone."""
import json
import pickle
from pathlib import Path
import sys
import wave
import numpy as np

source, dest = map(Path, sys.argv[1:3])
dest.mkdir(parents=True, exist_ok=True)
items = pickle.loads((source / 'out/posset.pkl').read_bytes())
voices = sorted({(x['voice'], x['lang']) for x in items if x['kind'] == 'pos'})
chosen = []
for lang in ['en', 'it', 'ru', 'ro', 'ja']:
    chosen.extend([v for v in voices if v[1] == lang][:4])
manifest = []
for voice, lang in chosen:
    mine = [x for x in items if x['voice'] == voice and x['lang'] == lang]
    order = [(0,'0.85'),(1,'1.15'),(2,'0.85'),(3,'1.15'),(0,'1.15')] if lang == 'en' else [(0,'0.85'),(1,'1.15'),(0,'1.15'),(1,'0.85'),(0,'1.0')]
    enrol = [next(x for x in mine if x['kind']=='pos' and x['cond']=='clean' and int(x['text_id'])==ti and x['speed']==sp) for ti,sp in order]
    enrol_ids = {x['id'] for x in enrol}
    test = [x for x in mine if x['kind']=='pos' and x['speed']=='1.0' and x['id'] not in enrol_ids]
    near = [x for x in mine if x['kind']=='near']
    row = {'voice':voice, 'lang':lang, 'enrol':[], 'test':[], 'near':[]}
    for kind, clips in [('enrol',enrol),('test',test),('near',near)]:
        for i, item in enumerate(clips):
            x = item['x']
            if kind == 'enrol': x = x[9600:int(item['end']*16000)+3200]
            file = dest / f'{len(manifest)}-{kind}-{i}.wav'
            with wave.open(str(file),'wb') as out:
                out.setnchannels(1); out.setsampwidth(2); out.setframerate(16000)
                out.writeframes((np.clip(x,-1,1)*32767).astype('<i2').tobytes())
            row[kind].append({'file':str(file),'condition':item['cond'],'seconds':len(x)/16000})
    manifest.append(row)
background = []
for lang in ['en','it','ru','ro','ja']:
    src = source / f'neg/cv_{lang}.wav'
    file = dest / f'background-{lang}.wav'
    with wave.open(str(src),'rb') as inp:
        inp.setpos(inp.getnframes()//5 + 16000*5)
        data = inp.readframes(24*60*16000)
    with wave.open(str(file),'wb') as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(16000); out.writeframes(data)
    background.append({'file':str(file),'seconds':len(data)/32000})
(dest/'manifest.json').write_text(json.dumps({'voices':manifest,'background':background},indent=2))
print('positives',sum(len(x['test']) for x in manifest),'background hours',sum(x['seconds'] for x in background)/3600)
