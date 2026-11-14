"""Build the requested blind offline listening page; never play audio."""
import hashlib
import html
import json
import pathlib
import random
import shutil

root = pathlib.Path('G:/FILOW/tmp/voice-natural')
dest = root / 'listen2'
dest.mkdir(exist_ok=True)
before = json.loads((root / 'round2/before-listen-all.json').read_text(encoding='utf-8'))
after = {r['id']: r for r in json.loads((root / 'round2/after-listen-all.json').read_text(encoding='utf-8'))}
body = ['<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width">',
        '<title>Filow: ascolto 2</title><style>html{color-scheme:light dark}body{font:17px system-ui;margin:2rem;max-width:960px}section{border-top:1px solid #888;padding:1rem 0}.clips{display:flex;flex-wrap:wrap;gap:1rem}label{display:grid;gap:.5rem}audio{width:min(300px,80vw)}p{line-height:1.5}h2{margin-top:2rem}</style>',
        '<h1>Filow: pronuncia e finali</h1><p>Ascolta A e B. Annota la preferita e le parole che suonano strane. Controlla le parole inglesi, le date, gli anni e la fine della frase. Le posizioni cambiano a caso per ogni frase. Nessun audio parte da solo. La pagina funziona senza Internet.</p>']
key = []
last_lang = None
for row in before:
    if row['lang'] != last_lang:
        body.append('<h2>' + row['lang'].upper() + '</h2>')
        last_lang = row['lang']
    order = [('before', row), ('after', after[row['id']])]
    random.SystemRandom().shuffle(order)
    body.append(f'<section><h3>{row["lang"].upper()} {row["index"]+1}</h3><div class="clips">')
    labels = {}
    for label, (mode, item) in zip('AB', order):
        name = f'{row["lang"]}-{row["index"]+1:02}-{label}.wav'
        source = pathlib.Path(item['wav'])
        shutil.copyfile(source, dest / name)
        labels[label] = {'variant':mode, 'speaker':item['sid'], 'sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
        body.append(f'<label>{label}<audio controls preload="none" src="{name}"></audio></label>')
    body.append('</div><p>' + html.escape(row['text']) + '</p></section>')
    key.append({'id':row['id'], 'text':row['text'], 'labels':labels})
# Russian speed: the round-2 voice at the current 1.05 lift against 1.0 (the owner picked speed100 once in round 1).
speed100 = {r['id']: r for r in json.loads((root / 'round2/speed100-listen-ru.json').read_text(encoding='utf-8'))}
body.append('<h2>RU: velocit&agrave;</h2><p>Stessa voce e stessa pronuncia, cambia solo la velocit&agrave;. Quale suona pi&ugrave; naturale?</p>')
for n, item_id in enumerate(['listen-ru-0', 'listen-ru-3', 'listen-ru-5'], 1):
    order = [('after-speed105', after[item_id]), ('after-speed100', speed100[item_id])]
    random.SystemRandom().shuffle(order)
    body.append(f'<section><h3>RU velocit&agrave; {n}</h3><div class="clips">')
    labels = {}
    for label, (mode, item) in zip('AB', order):
        name = f'ru-speed-{n:02}-{label}.wav'
        source = pathlib.Path(item['wav'])
        shutil.copyfile(source, dest / name)
        labels[label] = {'variant':mode, 'speaker':item['sid'], 'sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
        body.append(f'<label>{label}<audio controls preload="none" src="{name}"></audio></label>')
    body.append('</div><p>' + html.escape(after[item_id]['text']) + '</p></section>')
    key.append({'id':'speed-' + item_id, 'text':after[item_id]['text'], 'labels':labels})
body.append('</html>')
(dest / 'index.html').write_text('\n'.join(body),encoding='utf-8')
(root / 'listen2-key.json').write_text(json.dumps(key,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'{len(key)} A/B items, {len(key)*2} WAV files: {dest / "index.html"}')
