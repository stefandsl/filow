"""Aggregate retained measurements, with auditable normalized ASR references."""
import json
import pathlib
import re
import statistics
import sys
import unicodedata

ROOT = pathlib.Path('G:/FILOW/tmp/voice-natural')
sys.path.insert(0, str(ROOT / 'python'))
from num2words import num2words

def tokens(text, lang):
    text = unicodedata.normalize('NFKC', text).lower().replace('ё', 'е')
    text = re.sub(r'(?<=\d)[:.](?=\d)', ' ', text)
    if lang != 'ja':
        text = re.sub(r'\d+', lambda m: num2words(int(m[0]), lang=lang), text)
    text = ''.join(' ' if unicodedata.category(c)[0] in 'PS' else c for c in text)
    return list(''.join(text.split())) if lang == 'ja' else text.split()

def edits(a, b):
    row = list(range(len(b) + 1))
    for i, left in enumerate(a):
        new = [i + 1]
        for j, right in enumerate(b):
            new.append(min(row[j+1]+1, new[j]+1, row[j]+(left != right)))
        row = new
    return row[-1]

summary = []
for file in sorted(ROOT.glob('*-metrics.json')):
    name = file.name.removesuffix('-metrics.json')
    rows = json.loads(file.read_text(encoding='utf-8'))
    for lang in dict.fromkeys(r['lang'] for r in rows):
        selected = [r for r in rows if r['lang'] == lang]
        asrfile = ROOT / f'{name}-asr-{lang}.json'
        error_count = reference_count = None
        if asrfile.exists():
            asr = json.loads(asrfile.read_text(encoding='utf-8'))
            error_count = reference_count = 0
            for item in asr:
                ref, hyp = tokens(item['reference'], lang), tokens(item['hypothesis'], lang)
                item.update(referenceTokens=ref, hypothesisTokens=hyp, edits=edits(ref, hyp))
                error_count += item['edits']
                reference_count += len(ref)
            (ROOT / f'{name}-scored-{lang}.json').write_text(json.dumps(asr, ensure_ascii=False, indent=2),encoding='utf-8')
            if len(asr) != len(selected):
                error_count = reference_count = None
        summary.append({'variant': name, 'lang': lang, 'n':len(selected),
            'modelMiB': 380.4 if name == 'full' else 77.4 if name == 'piper' else 181.1 if name == 'kokoro' else 138.6,
            'license': 'MIT / CC0 dataset' if name == 'piper' else 'Apache-2.0' if name == 'kokoro' else 'OpenRAIL-M',
            'mosProxy': statistics.mean(r['mosProxy'] for r in selected),
            'errors':error_count, 'wordsOrChars':reference_count,
            'errorRate': 100*error_count/reference_count if reference_count else None,
            'f0StdHz':statistics.mean(r['f0StdHz'] for r in selected if r['f0StdHz'] is not None),
            'f0RangeHz':statistics.mean(r['f0RangeHz'] for r in selected if r['f0RangeHz'] is not None),
            'firstMs':statistics.median(r['firstMs'] for r in selected),
            'rtf':sum(r['workMs'] for r in selected)/1000/sum(r['seconds'] for r in selected),
            'rssMB':max(r.get('rssMB',0) for r in selected),
            'pauseMedianMs':statistics.median(r['pauseMedianMs'] for r in selected),
            'maxClipFraction':max(r['clippedFraction'] for r in selected)})
(ROOT / 'summary.json').write_text(json.dumps(summary,indent=2))
header = '| Variant | Language | n | MOS proxy | Errors | F0 SD/range Hz | First ms | RTF | RSS MiB | Model MiB | Licence |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|\n'
table = header + '\n'.join(f"| {r['variant']} | {r['lang']} | {r['n']} | {r['mosProxy']:.2f} | {str(r['errors'])+'/'+str(r['wordsOrChars']) if r['errors'] is not None else 'pending'} | {r['f0StdHz']:.1f}/{r['f0RangeHz']:.1f} | {r['firstMs']:.0f} | {r['rtf']:.3f} | {round(r['rssMB']) if r['rssMB'] else 'n/a'} | {r['modelMiB']} | {r['license']} |" for r in summary)
(ROOT / 'TABLE.md').write_text(table,encoding='utf-8')
print(table)
