"""Runs the whole bake-off for one split with at most 4 busy threads on this shared PC.

  python -I run_queue.py <dev|heldout> <questions|tracking> <engine,engine,...> [noraw]

Jobs: one enhancement per engine (1 thread each) and one recognizer run per arm (1 process with
2 threads). A recognizer run starts as soon as its enhanced clips exist; finished jobs are skipped
on a rerun. Progress goes to WORK/logs/queue-<split>-<use>.log with the machine's CPU load, so a
busy machine is on record.
"""
import subprocess
import sys
import time
from pathlib import Path

import psutil

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HERE, WORK

CAP = 4
EXTERNAL = ("rnnoise", "dfn3", "dfn3_ll")


def main():
    split, use = sys.argv[1], sys.argv[2]
    engines = [e for e in sys.argv[3].split(",") if e]
    arms = ([] if len(sys.argv) > 4 and sys.argv[4] == "noraw" else ["raw"]) + engines
    res, logs = WORK / "results", WORK / "logs"
    log = logs / f"queue-{split}-{use}.log"
    py = sys.executable

    def say(msg):
        with open(log, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%H:%M:%S')} cpu {psutil.cpu_percent(interval=None):.0f}% free {psutil.virtual_memory().available / 2 ** 30:.1f} GB | {msg}\n")

    jobs = []
    for arm in arms:  # recognizer runs first in the list: an arm is finished as early as possible
        jobs.append({"name": f"asr {arm}", "w": 2, "done": res / f"asr-{use}-{arm}-{split}-t2.jsonl",
                     "needs": None if arm == "raw" else res / f"enh-{arm}-{split}.csv",
                     "cmd": [py, "-I", str(HERE / "run_asr.py"), arm, split, use, "2", "1"]})
    for e in engines:
        jobs.append({"name": f"enh {e}", "w": 1, "done": res / f"enh-{e}-{split}.csv", "needs": None,
                     "cmd": [py, "-I", str(HERE / ("external.py" if e in EXTERNAL else "enhance.py")), "run", e, split]})
    jobs = [j for j in jobs if not j["done"].exists()]
    say(f"start {split} {use}: {[j['name'] for j in jobs]}")
    running = []
    while jobs or running:
        for j in list(running):
            code = j["proc"].poll()
            if code is not None:
                running.remove(j)
                say(f"{'done' if code == 0 and j['done'].exists() else 'FAILED'} {j['name']} in {time.time() - j['t0']:.0f} s")
                j["out"].close()
        used = sum(j["w"] for j in running)
        for j in list(jobs):
            if j["needs"] is not None and not j["needs"].exists():
                # its enhancement failed or is not there: drop it once nothing can still produce the file
                if not any(o["done"] == j["needs"] for o in jobs + running):
                    jobs.remove(j)
                    say(f"SKIPPED {j['name']}: no enhanced clips")
                continue
            if used + j["w"] <= CAP and psutil.virtual_memory().available / 2 ** 30 > (6 if j["w"] == 2 else 1):
                j["out"] = open(logs / f"job-{j['name'].replace(' ', '-')}-{split}-{use}.log", "w", encoding="utf-8")
                j["proc"] = subprocess.Popen(j["cmd"], stdout=j["out"], stderr=subprocess.STDOUT, cwd=str(HERE))
                j["t0"] = time.time()
                jobs.remove(j)
                running.append(j)
                used += j["w"]
                say(f"started {j['name']}")
        time.sleep(5)
    say("finished")


if __name__ == "__main__":
    main()
