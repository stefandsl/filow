"""Scores every arm of one split and applies the frozen gates.

  python -I score.py <dev|heldout> [questions|tracking]

Writes WORK/results/results-<use>-<split>.csv (one row per clip and arm, the column set fixed by the
programme brief), summary-<use>-<split>.json and summary-<use>-<split>.md.

Text normalisation "norm-v1" (same for reference and recognizer output):
  NFKC, case-folded, every punctuation and symbol character removed, whitespace collapsed;
  ro: s/t with cedilla -> comma below; ru: yo -> ye; ja: all whitespace removed and scored per
  character (CER); every other language per word (WER). No number or spelling rewriting.

Macro error rate of a set of clips = mean over the five languages of (errors / reference tokens)
pooled inside each language. Intervals: 2000 bootstrap draws that resample SPEAKERS with
replacement inside each language (all clips of a drawn speaker go together), the same draw for the
arm and for raw, 2.5 and 97.5 percentiles.
"""
import csv
import json
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import LANGS, MANIFEST, SEED, WORK, read_json, write_json

NORM_VERSION = "norm-v1"
ENV = ("keyboard", "fan", "traffic")
COLUMNS = ["run_id", "split", "utterance_id", "speaker_id", "language", "condition", "snr_db", "sir_db", "engine", "model_revision",
           "model_sha256", "runtime_version", "threads", "ref_words", "subs", "dels", "ins", "dsp_p50_ms", "dsp_p95_ms", "dsp_p99_ms",
           "rtf", "added_delay_ms", "cpu_pct", "rss_mib"]
ARMS = ["raw", "gtcrn", "dtln", "rnnoise", "dfn3", "dfn3_ll", "dpdfnet2", "dpdfnet2_48k", "hush",
        "dfn3_warm", "dpdfnet2_warm", "hush_warm"]  # *_warm: diagnostic arms of warm.py, outside the frozen protocol
RUNTIME = {"raw": "sherpa-onnx-node 2.0.1", "gtcrn": "onnxruntime 1.30.0", "dtln": "onnxruntime 1.30.0", "dpdfnet2": "onnxruntime 1.30.0",
           "dpdfnet2_48k": "onnxruntime 1.30.0", "rnnoise": "rnnoise 70f1d25 (MSVC 19.2x, AVX2)", "dfn3": "deep-filter 0.5.6 (tract)",
           "dfn3_ll": "deep-filter 0.5.6 (tract)", "hush": "weya_nc.dll from pulp-vision/Hush 9f6414e"}
MODEL_OF = {"dfn3": ("dfn3", "DeepFilterNet3_onnx.tar.gz"), "dfn3_ll": ("dfn3", "DeepFilterNet3_ll_onnx.tar.gz")}
B = 2000


def normalise(text, lang):
    t = unicodedata.normalize("NFKC", text or "").casefold()
    if lang == "ro":
        t = t.replace("ş", "ș").replace("ţ", "ț")
    if lang == "ru":
        t = t.replace("ё", "е")
    t = "".join(" " if unicodedata.category(ch)[0] in "PS" else ch for ch in t)
    if lang == "ja":
        return [ch for ch in t if not ch.isspace()]
    return t.split()


def edits(ref, hyp):
    """(substitutions, deletions, insertions) of the cheapest alignment."""
    n, m = len(ref), len(hyp)
    d = [[(j, 0, 0, j) for j in range(m + 1)]] + [[(i, 0, i, 0)] + [None] * m for i in range(1, n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if ref[i - 1] == hyp[j - 1]:
                d[i][j] = d[i - 1][j - 1]
                continue
            a, b, c = d[i - 1][j - 1], d[i - 1][j], d[i][j - 1]
            best = min(a[0], b[0], c[0])
            d[i][j] = (best + 1, a[1] + 1, a[2], a[3]) if a[0] == best else (best + 1, b[1], b[2] + 1, b[3]) if b[0] == best else (best + 1, c[1], c[2], c[3] + 1)
    return d[n][m][1:]


def family(cond):
    return "env" if cond in ENV else "voice" if cond.startswith("voice") else cond.split("_")[0]


def slice_name(r):
    c = r["condition"]
    return f"{c}_snr{r['snr_db']}" if r["snr_db"] != "" else f"{c}_sir{r['sir_db']}" if r["sir_db"] != "" else c


def main():
    split = sys.argv[1]
    use = sys.argv[2] if len(sys.argv) > 2 else "questions"
    res = WORK / "results"
    refs = {u["utterance_id"]: u["text"] for u in read_json(MANIFEST / "corpus.json")["utterances"]}
    models = {c["name"]: c for c in read_json(MANIFEST / "models.json")["candidates"]}
    with open(MANIFEST / "clips.csv", "r", encoding="utf-8", newline="") as f:
        clips = [r for r in csv.DictReader(f) if r["split"] == split and r["tier"] == "core"]
    arms = [a for a in ARMS if (res / f"asr-{use}-{a}-{split}-t2.jsonl").exists()]
    rows, per = [], {}  # per[arm][clip_id] = (ref_n, subs, dels, ins)
    for arm in arms:
        hyp = {}
        with open(res / f"asr-{use}-{arm}-{split}-t2.jsonl", "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    j = json.loads(line)
                    hyp[j["clip_id"]] = j["text"]
        timing = {}
        if arm != "raw":
            with open(res / f"enh-{arm}-{split}.csv", "r", encoding="utf-8", newline="") as f:
                timing = {r["wav_id"]: r for r in csv.DictReader(f)}
        base = arm[:-5] if arm.endswith("_warm") else arm
        folder, only = MODEL_OF.get(base, (base, None))
        files = [x for x in models.get(folder, {}).get("files", []) if (only is None or x["file"] == only) and not x["file"].endswith(".exe")]
        per[arm] = {}
        for c in clips:
            ref = normalise(refs.get(c["utterance_id"], ""), c["language"])
            s, d, i = edits(ref, normalise(hyp[c["clip_id"]], c["language"]))
            per[arm][c["clip_id"]] = (len(ref), s, d, i)
            t = timing.get(c["wav_id"], {})
            rows.append({"run_id": f"2026-11-12-{use}-{NORM_VERSION}", "split": split, "utterance_id": c["utterance_id"] or c["wav_id"],
                         "speaker_id": c["speaker_id"], "language": c["language"], "condition": c["condition"], "snr_db": c["snr_db"],
                         "sir_db": c["sir_db"], "engine": arm, "model_revision": models.get(folder, {}).get("revision", ""),
                         "model_sha256": "+".join(x["sha256"] for x in files), "runtime_version": RUNTIME[base], "threads": t.get("threads", ""),
                         "ref_words": len(ref), "subs": s, "dels": d, "ins": i, **{k: t.get(k, "") for k in COLUMNS[17:]}})
    with open(res / f"results-{use}-{split}.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)

    # ---- aggregates with speaker-clustered bootstrap ----
    speech = [c for c in clips if not c["condition"].startswith("noiseonly")]
    speakers = sorted({(c["language"], c["speaker_id"]) for c in speech})
    spk_ix = {s: k for k, s in enumerate(speakers)}
    rng = np.random.default_rng(SEED)
    draws = np.zeros((B, len(speakers)))
    for lang in LANGS:
        ix = [k for k, s in enumerate(speakers) if s[0] == lang]
        draws[:, ix] = rng.multinomial(len(ix), [1 / len(ix)] * len(ix), size=B)

    def sums(arm, pick, what="err"):
        """per language: (speaker x 1) arrays of errors and reference tokens for clips where pick(c)."""
        e = np.zeros((len(LANGS), len(speakers)))
        n = np.zeros((len(LANGS), len(speakers)))
        for c in speech:
            if pick(c):
                rn, s, d, i = per[arm][c["clip_id"]]
                li, k = LANGS.index(c["language"]), spk_ix[(c["language"], c["speaker_id"])]
                e[li, k] += d if what == "dels" else s + d + i
                n[li, k] += rn
        return e, n

    def macro(e, n, weights=None):
        """macro rate (percent); weights: (B x speakers) draws or None for the point estimate."""
        if weights is None:
            per_lang = [e[li].sum() / n[li].sum() for li in range(len(LANGS)) if n[li].sum() > 0]
            return 100 * float(np.mean(per_lang))
        vals = [(weights @ e[li]) / np.maximum(1e-9, weights @ n[li]) for li in range(len(LANGS)) if n[li].sum() > 0]
        return 100 * np.mean(vals, axis=0)

    def compare(arm, pick, what="err"):
        e0, n0 = sums("raw", pick, what)
        e1, n1 = sums(arm, pick, what)
        raw, got = macro(e0, n0), macro(e1, n1)
        diff = macro(e1, n1, draws) - macro(e0, n0, draws)
        lo, hi = np.percentile(diff, [2.5, 97.5])
        return {"raw": round(raw, 2), "arm": round(got, 2), "diff": round(got - raw, 2), "diff_lo": round(float(lo), 2), "diff_hi": round(float(hi), 2),
                "rel_reduction_pct": round(100 * (raw - got) / raw, 1) if raw else 0.0, "ref_tokens": int(n0.sum())}

    sets = {
        "clean": lambda c: c["condition"] == "clean",
        "quiet": lambda c: c["condition"] == "quiet",
        "noisy_env_all": lambda c: c["condition"] in ENV,
        "hard_env_snr0_5": lambda c: c["condition"] in ENV and c["snr_db"] in ("0", "5"),
        "voice_same": lambda c: c["condition"] == "voice_same",
        "voice_diff": lambda c: c["condition"] == "voice_diff",
        "echo": lambda c: c["condition"] == "echo",
        "voice_all": lambda c: c["condition"] in ("voice_same", "voice_diff"),
    }
    for kind in ENV:
        for snr in ("0", "5", "10", "20"):
            sets[f"{kind}_snr{snr}"] = lambda c, kind=kind, snr=snr: c["condition"] == kind and c["snr_db"] == snr
    for kind in ("voice_same", "voice_diff", "echo"):
        for sir in ("0", "12"):
            sets[f"{kind}_sir{sir}"] = lambda c, kind=kind, sir=sir: c["condition"] == kind and c["sir_db"] == sir
    summary = {"split": split, "use": use, "normalisation": NORM_VERSION, "bootstrap_draws": B, "arms": {}, "raw": {}}
    for name, pick in sets.items():
        e, n = sums("raw", pick)
        summary["raw"][name] = round(macro(e, n), 2)
    for lang in LANGS:
        for name in ("clean", "quiet", "noisy_env_all", "hard_env_snr0_5", "voice_same", "voice_diff", "echo"):
            e, n = sums("raw", lambda c, lang=lang, name=name: c["language"] == lang and sets[name](c))
            summary["raw"][f"{lang}:{name}"] = round(100 * e.sum() / max(1, n.sum()), 2)
    noise_only = [c for c in clips if c["condition"].startswith("noiseonly")]
    summary["raw"]["noise_only_tokens"] = {lang: sum(per["raw"][c["clip_id"]][3] for c in noise_only if c["language"] == lang) for lang in LANGS}
    for arm in arms:
        if arm == "raw":
            continue
        a = {name: compare(arm, pick) for name, pick in sets.items()}
        a["quiet_deletions"] = compare(arm, sets["quiet"], "dels")
        a["by_language"] = {}
        for lang in LANGS:
            for name in ("clean", "quiet", "noisy_env_all", "hard_env_snr0_5", "voice_same", "voice_diff", "echo"):
                a["by_language"][f"{lang}:{name}"] = compare(arm, lambda c, lang=lang, name=name: c["language"] == lang and sets[name](c))
        worse = []
        for lang in LANGS:
            for sl in sorted({slice_name(c) for c in speech}):
                r = compare(arm, lambda c, lang=lang, sl=sl: c["language"] == lang and slice_name(c) == sl)
                if r["diff"] > 1.0:
                    worse.append({"slice": f"{lang}:{sl}", **r, "low_count": r["ref_tokens"] < 500, "significant": r["diff_lo"] > 0})
        a["slices_worse_than_1pt"] = worse
        a["noise_only_tokens"] = {lang: sum(per[arm][c["clip_id"]][3] for c in noise_only if c["language"] == lang) for lang in LANGS}
        summary["arms"][arm] = a
    write_json(res / f"summary-{use}-{split}.json", summary)

    # ---- markdown ----
    out = [f"## {split} split, recognizer use: {use}, {NORM_VERSION}", ""]
    names = ["clean", "quiet", "noisy_env_all", "hard_env_snr0_5", "voice_same", "voice_diff", "echo"]
    out += ["| arm | " + " | ".join(names) + " | quiet dels | noise-only tokens |", "|---|" + "---|" * (len(names) + 2)]
    out.append("| raw | " + " | ".join(f"{summary['raw'][n]:.2f}" for n in names) + " | - | " + str(sum(summary["raw"]["noise_only_tokens"].values())) + " |")
    for arm, a in summary["arms"].items():
        cells = [f"{a[n]['arm']:.2f} ({a[n]['diff']:+.2f}; {a[n]['diff_lo']:+.2f}..{a[n]['diff_hi']:+.2f})" for n in names]
        q = a["quiet_deletions"]
        out.append(f"| {arm} | " + " | ".join(cells) + f" | {q['arm']:.2f} ({q['diff']:+.2f}) | {sum(a['noise_only_tokens'].values())} |")
    out += ["", "Per condition (macro error rate, percent):", "", "| condition | " + " | ".join(arms) + " |", "|---|" + "---|" * len(arms)]
    for name in [n for n in sets if "_snr" in n and n != "hard_env_snr0_5" or "_sir" in n]:
        out.append(f"| {name} | {summary['raw'][name]:.2f} | " + " | ".join(f"{summary['arms'][a][name]['arm']:.2f}" for a in arms if a != "raw") + " |")
    out += ["", "Gates:", "", "| arm | noisy: rel. reduction (>= 5 %, interval below 0) | clean: diff (<= +0.5) | slices > 1 pt worse (significant / all) | quiet deletions diff (<= +0.5) | noise-only tokens (<= raw) |", "|---|---|---|---|---|---|"]
    for arm, a in summary["arms"].items():
        n, c, q = a["noisy_env_all"], a["clean"], a["quiet_deletions"]
        g1 = n["rel_reduction_pct"] >= 5 and n["diff_hi"] < 0
        g2 = c["diff"] <= 0.5
        sig = [w for w in a["slices_worse_than_1pt"] if w["significant"]]
        g3 = not sig
        g4 = q["diff"] <= 0.5
        g5 = sum(a["noise_only_tokens"].values()) <= sum(summary["raw"]["noise_only_tokens"].values())
        mark = lambda ok: "PASS" if ok else "FAIL"
        out.append(f"| {arm} | {mark(g1)} {n['rel_reduction_pct']:+.1f} % ({n['diff_lo']:+.2f}..{n['diff_hi']:+.2f} pt) | {mark(g2)} {c['diff']:+.2f} | {mark(g3)} {len(sig)} / {len(a['slices_worse_than_1pt'])} | "
                   f"{mark(g4)} {q['diff']:+.2f} | {mark(g5)} {sum(a['noise_only_tokens'].values())} vs {sum(summary['raw']['noise_only_tokens'].values())} |")
    out += ["", "Speaker isolation gate (competing voice, same and other language pooled): relative reduction >= 5 % with the interval below 0:", ""]
    for arm, a in summary["arms"].items():
        v = a["voice_all"]
        ok = v["rel_reduction_pct"] >= 5 and v["diff_hi"] < 0
        out.append(f"- {arm}: {'PASS' if ok else 'FAIL'} raw {v['raw']:.2f} -> {v['arm']:.2f} ({v['rel_reduction_pct']:+.1f} %; {v['diff_lo']:+.2f}..{v['diff_hi']:+.2f} pt)")
    (res / f"summary-{use}-{split}.md").write_text("\n".join(out) + "\n", encoding="utf-8")
    print("\n".join(out))


if __name__ == "__main__":
    main()
