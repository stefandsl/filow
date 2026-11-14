"""Copy the complete numeric evidence into a reviewable repository document."""
import json
import pathlib

root = pathlib.Path('G:/FILOW/tmp/voice-natural')
rows = json.loads((root/'summary.json').read_text())
assert sum(row['n'] for row in rows) == 652
assert all(row['errors'] is not None for row in rows)
text = '''# Natural voice measurement tables

See [method, selection, licences and limits](VOICE-NATURAL-2026-11.md).
MOS is the local DNSMOS P.808 proxy, not a human naturalness rating. Errors are
Whisper word edits/reference words, or character edits/reference characters for
Japanese. F0 is mean per-answer voiced SD/full range; per-piece values are retained
in the raw metrics. First is median warm first-piece time, not physical output.
RSS is sampled, not peak. Sizes are extracted model assets, not download archives.
Pause is median per-answer median RMS silence run (>=80 ms). RTF <1 is real time.
All models are CPU-only, four threads, on an i9-13900KF. Timing the initial baseline
during dependency work inflated it; use baseline-repeat. Pipeline includes worker
delivery but does not measure realtime playback starvation; separate queue results
in the main report do. Each variant is one take, so small differences are uncertain.

Supertonic variants cover all five languages under OpenRAIL-M. Full is the third
alternative evaluated alongside Piper and Kokoro, not a separate architecture.
Piper covers EN/IT/RU/RO here (Joe/Paola/Denis/Mihai); voice-specific CC0 datasets
and MIT repository declaration were checked. Kokoro covers EN/IT in this export;
Japanese exists upstream but was not verified here, and RU/RO are unsupported.
All applicable upstream licence conditions still apply. No candidate was shipped.

'''
text += (root/'TABLE.md').read_text(encoding='utf-8')
text += '\n\n## Pause and clipping checks\n\n| Variant | Language | Pause median ms | Clipped sample fraction |\n|---|---|---:|---:|\n'
text += '\n'.join(f"| {r['variant']} | {r['lang']} | {r['pauseMedianMs']:.0f} | {r['maxClipFraction']:.6f} |" for r in rows)
pathlib.Path('docs/okfilow/VOICE-NATURAL-TABLES.md').write_text(text+'\n',encoding='utf-8')
print(f"Published {len(rows)} language/variant rows, {sum(r['n'] for r in rows)} renders")
