"""Runs Filow's recognizer (asr.mjs) over one arm and split.

Usage: python -I run_asr.py <arm> <dev|heldout> [questions|tracking] [threads] [shards]
arm "raw" reads WORK/mix/16k, any other arm reads WORK/enh/<arm>.
threads: recognizer threads per process (Filow uses 4 on this PC; the benchmark uses 2 threads in
2 processes for every arm, after checking on dev that the text is the same as with 4).
"""
import csv
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HERE, MANIFEST, WORK


def main():
    arm, split = sys.argv[1], sys.argv[2]
    use = sys.argv[3] if len(sys.argv) > 3 else "questions"
    threads = sys.argv[4] if len(sys.argv) > 4 else "2"
    shards = int(sys.argv[5]) if len(sys.argv) > 5 else 2
    src = WORK / "mix" / "16k" if arm == "raw" else WORK / "enh" / arm
    lines = []
    with open(MANIFEST / "clips.csv", "r", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            wav = src / f"{r['wav_id']}.wav"
            if r["split"] == split and r["tier"] == "core" and wav.exists():
                lines.append(f"{r['clip_id']}\t{wav}\t{r['language']}")
    res = WORK / "results"
    res.mkdir(exist_ok=True)
    tag = f"{use}-{arm}-{split}-t{threads}"
    final = res / f"asr-{tag}.jsonl"
    if final.exists():
        print("already done:", final)
        return
    procs, parts = [], []
    for i in range(shards):
        lst = res / f"list-{tag}-{i}.tsv"
        lst.write_text("\n".join(lines[i::shards]) + "\n", encoding="utf-8")
        part = res / f"part-{tag}-{i}.jsonl"
        parts.append(part)
        if part.exists():
            # left by an interrupted run: keep whole lines only and redo the last five, which may
            # not have reached the disk intact (asr.mjs skips the clips already in this file)
            whole = []
            for line in part.read_bytes().split(b"\n"):
                try:
                    json.loads(line.decode("utf-8"))
                    whole.append(line.decode("utf-8"))
                except ValueError:
                    continue
            part.write_text("".join(w + "\n" for w in whole[:-5]), encoding="utf-8", newline="\n")
        procs.append(subprocess.Popen(["node", str(HERE / "asr.mjs"), "--list", str(lst), "--out", str(part), "--use", use, "--threads", threads],
                                      stdout=subprocess.DEVNULL))
    codes = [p.wait() for p in procs]
    if any(codes):
        sys.exit(f"asr.mjs failed: {codes} (rerun to resume)")
    got = [line for part in parts for line in part.read_text(encoding="utf-8").splitlines() if line]
    if len(got) != len(lines):
        sys.exit(f"expected {len(lines)} results, got {len(got)}")
    tmp = res / f"asr-{tag}.jsonl.tmp"
    tmp.write_text("\n".join(got) + "\n", encoding="utf-8")
    os.replace(tmp, final)  # the result file appears only when it is whole
    for part in parts:
        part.unlink()
    print("done", tag, len(got), "clips")


if __name__ == "__main__":
    main()
