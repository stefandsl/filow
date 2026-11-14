"""Create the offline blind comparison from explicit per-language selections."""
import hashlib
import html
import json
import pathlib
import random
import shutil

root = pathlib.Path('G:/FILOW/tmp/voice-natural')
selection = json.loads((root / 'selection.json').read_text(encoding='utf-8'))
corpus = json.loads(pathlib.Path('tools/voice-natural/corpus.json').read_text(encoding='utf-8'))
dest = root / 'listen'
dest.mkdir(exist_ok=True)
key = []
body = ['<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width">',
        '<title>OK Filow: confronto delle voci</title>',
        '<style>body{font:17px system-ui;margin:2rem;max-width:1100px}section{margin:2rem 0;border-top:1px solid #aaa} .clips{display:flex;flex-wrap:wrap;gap:1rem}label{display:grid;gap:.5rem}audio{width:300px}p{white-space:pre-wrap}</style>',
        '<h1>OK Filow: quale voce preferisci?</h1>',
        '<p>Per ogni frase ascolta A, B e C e annota la preferita. L’ordine cambia per ogni frase. Nessun audio parte automaticamente. Questa pagina funziona senza Internet.</p>']
for lang, texts in corpus.items():
    variants = selection[lang]
    if len(variants) != 3 or len(set(variants)) != 3:
        raise ValueError('Select baseline and two distinct candidates for ' + lang)
    body.append('<h2>' + lang.upper() + '</h2>')
    for index in range(12) if lang == 'it' else [0, 1, 3]:
        text = texts[index]
        order = variants.copy()
        random.SystemRandom().shuffle(order)
        body.append(f'<section><h3>{lang.upper()} {index+1}</h3><p>{html.escape(text)}</p><div class="clips">')
        mapping = {}
        for label, variant in zip('ABC', order):
            source = root / 'audio' / variant / f'{lang}-{index}.wav'
            filename = f'{lang}-{index:02}-{label}.wav'
            shutil.copyfile(source, dest / filename)
            mapping[label] = {'variant':variant, 'sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
            body.append(f'<label>{label}<audio controls preload="none" src="{filename}"></audio></label>')
        body.append('</div></section>')
        key.append({'lang':lang,'index':index,'labels':mapping})
body.append('<h2>Ritmo delle risposte: prima e dopo</h2><p>Questi confronti aggiuntivi includono le pause misurate della coda vocale. La voce resta la stessa.</p>')
for index in range(3):
    body.append(f'<section><h3>Ritmo {index+1}</h3><div class="clips">')
    for variant, label in [('before','Prima'),('after','Dopo')]:
        filename = f'queue-{variant}-{index}.wav'
        shutil.copyfile(root / filename, dest / filename)
        body.append(f'<label>{label}<audio controls preload="none" src="{filename}"></audio></label>')
    body.append('</div></section>')
body.append('</html>')
(dest / 'index.html').write_text('\n'.join(body),encoding='utf-8')
(root / 'listen-key.json').write_text(json.dumps(key,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'{len(key)} blind comparisons and 3 flow comparisons: {dest / "index.html"}')
