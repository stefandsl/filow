"""Checks that what a finished job left on disk is whole (written after a power cut killed a run).

  python -I verify_outputs.py <dev|heldout> <engine,engine,...> [recompute]

Per engine: the timing table has one parsable row per core clip; every enhanced wav opens, is
16 kHz mono PCM16 and has the length of its input (deep-filter with delay compensation returns a
clip that is a fixed 30 ms shorter: a constant difference of at most 50 ms is accepted and printed).
A quarter of a file that is exactly zero while the input has signal is what data that never reached
the disk looks like, but also what a strong suppressor can produce: such clips are suspects.
"recompute" runs the engine again on the suspects, the 40 clips written last and 40 spread over the
split and compares sample by sample; a suspect that comes out the same is fine.
The 16 kHz inputs are checked against the sha256 in clips.csv.
Prints one line per engine. Exit code 1 when anything is bad or a suspect could not be recomputed.
"""
import csv
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import WORK, sha256_file
from enhance import clips_of


def inputs_ok(todo):
    bad = [r["wav_id"] for r in todo if sha256_file(WORK / "mix" / "16k" / f"{r['wav_id']}.wav") != r["sha256_16k"]]
    print("inputs 16k:", "OK" if not bad else f"BAD {len(bad)} {bad[:5]}", f"({len(todo)} clips)")
    return not bad


def table_ok(name, split, todo):
    path = WORK / "results" / f"enh-{name}-{split}.csv"
    if not path.exists():
        return ["no timing table"]
    data = path.read_bytes()
    if b"\x00" in data or not data.endswith(b"\n"):
        return ["timing table damaged"]
    rows = list(csv.DictReader(data.decode("utf-8").splitlines()))
    problems = []
    if [r["wav_id"] for r in rows] != [r["wav_id"] for r in todo]:
        problems.append(f"timing table rows {len(rows)} do not match the {len(todo)} clips")
    for r in rows:
        try:
            float(r["rtf"]), float(r["added_delay_ms"]), float(r["cpu_pct"]), float(r["rss_mib"])
        except (TypeError, ValueError, KeyError):
            problems.append(f"row {r.get('wav_id')} unreadable")
            break
    return problems


def wavs_ok(name, todo):
    """Returns (bad, suspects, set of length differences in samples)."""
    bad, suspects, diffs = [], [], set()
    for r in todo:
        out = WORK / "enh" / name / f"{r['wav_id']}.wav"
        try:
            y, sr = sf.read(str(out), dtype="int16")
            x, _ = sf.read(str(WORK / "mix" / "16k" / f"{r['wav_id']}.wav"), dtype="int16")
            info = sf.info(str(out))
        except Exception as err:  # missing, zero length, broken header
            bad.append(f"{r['wav_id']}: {type(err).__name__}")
            continue
        if sr != 16000 or info.channels != 1 or info.subtype != "PCM_16":
            bad.append(f"{r['wav_id']}: format")
            continue
        diffs.add(len(x) - len(y))
        if not 0 <= len(x) - len(y) <= 800:
            bad.append(f"{r['wav_id']}: length {len(y)} for {len(x)}")
            continue
        q = len(y) // 4
        if any(q and not y[at:at + q].any() and np.abs(x[at:at + q]).max() > 200 for at in range(0, 4 * q, q)):
            suspects.append(r)
    if len(diffs) > 1:
        bad.append(f"length difference is not constant: {sorted(diffs)[:6]}")
    return bad, suspects, diffs


def pcm(y):
    return (np.clip(y, -1, 1) * 32768).clip(-32768, 32767).astype(np.int16)


def recompute(name, todo, suspects):
    from engines import ONNX_ENGINES
    by_time = sorted(todo, key=lambda r: (WORK / "enh" / name / f"{r['wav_id']}.wav").stat().st_mtime)
    pick = list({r["wav_id"]: r for r in suspects + by_time[-40:] + todo[::max(1, len(todo) // 40)]}.values())
    want = {}
    if name in ONNX_ENGINES:
        from enhance import delay_of, read, run_stream
        delay, probe = delay_of(name)
        for r in pick:
            x = read(r["wav_id"], probe.sr)
            y = run_stream(ONNX_ENGINES[name](1), x)[delay:delay + len(x)]
            want[r["wav_id"]] = pcm(signal.resample_poly(y, 1, 3) if probe.sr == 48000 else y)
    elif name == "rnnoise":
        from external import probe as probe_delay, read48, rnnoise_file
        delay = probe_delay(name)
        for r in pick:
            x = read48(r["wav_id"])
            y, _, _, _ = rnnoise_file(x, "verify")
            want[r["wav_id"]] = pcm(signal.resample_poly(y[delay:delay + len(x)], 1, 3))
    else:
        from external import TMP, df_batch
        stage = TMP / f"df-verify-{name}"
        for r in pick:
            df_batch(name, [r["wav_id"]], stage)  # one process per clip, as in the run
            y, _ = sf.read(str(stage / f"{r['wav_id']}.wav"), dtype="float32")
            want[r["wav_id"]] = pcm(signal.resample_poly(y, 1, 3))
            (stage / f"{r['wav_id']}.wav").unlink()
    bad = []
    for r in pick:
        got, _ = sf.read(str(WORK / "enh" / name / f"{r['wav_id']}.wav"), dtype="int16")
        w = want[r["wav_id"]]
        # deep-filter is not bit-exact from run to run (same input twice: 71 to 92 dB apart), so
        # the test is the error power: under -50 dB of the signal, or within one step for silence
        err = (got.astype(np.float64) - w.astype(np.float64)) if len(got) == len(w) else None
        if err is None or (np.abs(err).max() > 1 and np.mean(err ** 2) > 1e-5 * np.mean(w.astype(np.float64) ** 2)):
            bad.append(f"{r['wav_id']}: differs from a fresh run")
    return bad, len(pick)


def main():
    split = sys.argv[1]
    todo = clips_of(split)
    failed = not inputs_ok(todo)
    again = len(sys.argv) > 3 and sys.argv[3] == "recompute"
    for name in sys.argv[2].split(","):
        problems = table_ok(name, split, todo)
        bad, suspects, diffs = wavs_ok(name, todo)
        problems += bad
        note = f"; {len(suspects)} clips with a zero quarter" if suspects else ""
        if diffs - {0}:
            note += f"; shorter than the input by {sorted(diffs)} samples"
        if again and not problems:
            bad, n = recompute(name, todo, suspects)
            note += f"; fresh run of {n} clips: " + ("identical" if not bad else f"{len(bad)} DIFFERENT")
            problems += bad
        elif suspects:
            problems.append("suspects not recomputed")
        print(f"{name}: {'OK' if not problems else 'BAD ' + str(len(problems)) + ' ' + str(problems[:6])}{note}", flush=True)
        failed = failed or bool(problems)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
