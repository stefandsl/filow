"""Times every engine one after the other and applies the light / quality mode gates.

  python -I run_perf.py measure <engine,engine,...>   appends to WORK/results/perf.csv
  python -I run_perf.py table                         prints the markdown tables with the gates

Per engine, on this PC with no confinement: alone with 1 thread, alone with 2 threads (onnxruntime
engines only; RNNoise, deep-filter and the Hush DLL are single-threaded), and with 1 thread while
Filow's streaming recognizer (Nemotron, 3 threads, asr.mjs) transcribes at full speed in another
process. 40 held-out clips at SNR 5.

Then the same alone / with-recognizer pair on the stand-in for a modest PC: the engine and the
recognizer together confined to 4 efficiency cores of this CPU (logical processors 16-19 of the
i9-13900KF: Gracemont cores, the core type of an Intel N100, here with a faster clock, a larger
cache and faster memory, so the stand-in flatters a real small PC). No second machine was used.
"""
import csv
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HERE, WORK

EXTERNAL = ("rnnoise", "dfn3", "dfn3_ll")
ONE_THREAD = EXTERNAL + ("hush",)
OUT = WORK / "results" / "perf.csv"
HEADER = "engine,threads,state,hop_ms,p50_ms,p95_ms,p99_ms,max_ms,rtf,cpu_pct_of_one_core,rss_added_mib,machine_cpu_pct,audio_s,recognizer_still_running,machine"
MODEST = {"MIC_BENCH_AFFINITY": "16,17,18,19", "MIC_BENCH_MACHINE": "4 efficiency cores"}


def measure(engines):
    if not OUT.exists():
        OUT.write_text(HEADER + "\n", encoding="utf-8")
    for e in engines:
        one = [] if e in EXTERNAL else ["1"]
        runs = [({}, ["perf", e] + one), ({}, ["perf", e] + one + ["busy"]), (MODEST, ["perf", e] + one), (MODEST, ["perf", e] + one + ["busy"])]
        if e not in ONE_THREAD:
            runs.insert(1, ({}, ["perf", e, "2"]))
        for env, args in runs:
            script = "external.py" if e in EXTERNAL else "enhance.py"
            got = subprocess.run([sys.executable, "-I", str(HERE / script)] + args, capture_output=True, text=True, cwd=str(HERE), env={**os.environ, **env})
            line = next((ln for ln in got.stdout.splitlines() if ln.startswith("PERF,")), None)
            if line is None:
                print("FAILED", e, args, got.stderr[-300:], flush=True)
                continue
            with open(OUT, "a", encoding="utf-8") as f:
                f.write(line[5:] + "\n")
            print(line, flush=True)


def latency_ms(engine):
    """Latency with no processing time, from the held-out enhancement table."""
    path = WORK / "results" / f"enh-{engine}-heldout.csv"
    with open(path, "r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    return min(float(r["added_delay_ms"]) - (float(r["dsp_p95_ms"]) if r["dsp_p95_ms"] else 0.0) for r in rows)


def table():
    with open(OUT, "r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    print("| engine | machine | threads | state | hop ms | p50 / p95 / p99 / max ms per hop | RTF | CPU % of one core | memory added MiB | machine CPU % | recognizer ran to the end |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        hops = " / ".join(r[k] or "-" for k in ("p50_ms", "p95_ms", "p99_ms", "max_ms"))
        ran = "-" if r["state"] == "alone" else ("yes" if r["recognizer_still_running"] == "1" else "NO")
        print(f"| {r['engine']} | {r['machine']} | {r['threads']} | {r['state']} | {r['hop_ms']} | {hops} | {r['rtf']} | {r['cpu_pct_of_one_core']} | {r['rss_added_mib']} | {r['machine_cpu_pct']} | {ran} |")
    for machine in dict.fromkeys(r["machine"] for r in rows):
        print()
        print(f"Gates on: {machine}")
        print()
        print("| engine | latency ms | added delay p95 ms (worst state) | CPU % (1 thread, alone) | memory MiB | p99 under 80 % of hop | RTF with recognizer | light mode | quality mode |")
        print("|---|---|---|---|---|---|---|---|---|")
        here = [r for r in rows if r["machine"] == machine]
        for e in dict.fromkeys(r["engine"] for r in here):
            mine = [r for r in here if r["engine"] == e]
            alone = next(r for r in mine if r["state"] == "alone" and r["threads"] == "1")
            busy = next((r for r in mine if r["state"] == "asr-running"), None)
            lat = latency_ms(e)
            p95 = max(float(r["p95_ms"]) for r in mine if r["p95_ms"]) if any(r["p95_ms"] for r in mine) else None
            p99 = max(float(r["p99_ms"]) for r in mine if r["p99_ms"]) if any(r["p99_ms"] for r in mine) else None
            delay = lat + (p95 or 0.0)
            cpu, rss = float(alone["cpu_pct_of_one_core"]), max(float(r["rss_added_mib"]) for r in mine)
            rtf = float(busy["rtf"]) if busy else None
            hop_ok = None if p99 is None else p99 < 0.8 * float(alone["hop_ms"])
            common = (hop_ok is not False) and rtf is not None and rtf <= 0.5
            light = common and delay <= 40 and cpu <= 25 and rss <= 100
            quality = common and delay <= 80 and cpu <= 50 and rss <= 250
            note = "" if p95 is not None else " (no per-hop timing: latency only)"
            print(f"| {e} | {lat:.0f} | {delay:.1f}{note} | {cpu:.1f} | {rss:.0f} | {'not measured' if hop_ok is None else ('yes' if hop_ok else 'NO')} ({p99 if p99 is not None else '-'}) | "
                  f"{'not measured' if rtf is None else f'{rtf:.3f}'} | {'PASS' if light else 'FAIL'} | {'PASS' if quality else 'FAIL'} |")


if __name__ == "__main__":
    if sys.argv[1] == "measure":
        measure(sys.argv[2].split(","))
    else:
        table()
