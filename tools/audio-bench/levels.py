"""Shows that each engine does what it is built for, apart from the recognizer: how much it turns
down the noise-only clips and how much it changes the level of clean and quiet speech.

  python -I levels.py <dev|heldout> <engine,engine,...>

Output level minus input level in dB, median (worst..best) over the clips of each kind.
"""
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import WORK
from enhance import clips_of


def level(path):
    x, _ = sf.read(str(path), dtype="float32")
    return 10 * np.log10(np.mean(x ** 2) + 1e-12)


def main():
    todo = clips_of(sys.argv[1])
    kinds = {"noise only": lambda r: r["condition"].startswith("noiseonly"), "clean speech": lambda r: r["condition"] == "clean",
             "quiet speech": lambda r: r["condition"] == "quiet"}
    print("| engine | " + " | ".join(kinds) + " | quiet clips turned down by more than 20 dB |")
    print("|---|" + "---|" * (len(kinds) + 1))
    for name in sys.argv[2].split(","):
        cells, lost = [], ""
        for kind, pick in kinds.items():
            d = [level(WORK / "enh" / name / f"{r['wav_id']}.wav") - level(WORK / "mix" / "16k" / f"{r['wav_id']}.wav") for r in todo if pick(r)]
            cells.append(f"{np.median(d):+.1f} ({min(d):+.1f}..{max(d):+.1f})")
            if kind == "quiet speech":
                lost = f"{sum(1 for v in d if v < -20)} of {len(d)}"
        print(f"| {name} | " + " | ".join(cells) + f" | {lost} |")


if __name__ == "__main__":
    main()
