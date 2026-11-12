"""Prints the per-language tables of the document from a summary written by score.py.

  python -I report.py <dev|heldout> [questions|tracking]

Each cell: error rate of the arm, in brackets the difference from raw in points; a star marks a
difference whose 95 % interval excludes zero.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import LANGS, WORK, read_json


def main():
    split = sys.argv[1]
    use = sys.argv[2] if len(sys.argv) > 2 else "questions"
    s = read_json(WORK / "results" / f"summary-{use}-{split}.json")
    arms = list(s["arms"])
    for name, title in (("noisy_env_all", "Noisy (keyboard, fan, traffic; all four SNR)"), ("clean", "Clean"), ("quiet", "Quiet"),
                        ("hard_env_snr0_5", "Hard (SNR 0 and 5)"), ("voice_same", "Competing voice, same language"),
                        ("voice_diff", "Competing voice, other language"), ("echo", "Echo")):
        print(f"{title}, error rate per language (percent; ja per character):")
        print()
        print("| language | raw | " + " | ".join(arms) + " |")
        print("|---|---|" + "---|" * len(arms))
        for lang in LANGS:
            cells = []
            for a in arms:
                r = s["arms"][a]["by_language"][f"{lang}:{name}"]
                star = "*" if r["diff_lo"] > 0 or r["diff_hi"] < 0 else ""
                cells.append(f"{r['arm']:.1f} ({r['diff']:+.1f}{star})")
            print(f"| {lang} | {s['raw'][f'{lang}:{name}']:.1f} | " + " | ".join(cells) + " |")
        print()
    print("Slices more than 1 point worse with an interval that excludes zero (language:condition, points):")
    print()
    for a in arms:
        sig = sorted((w for w in s["arms"][a]["slices_worse_than_1pt"] if w["significant"]), key=lambda w: -w["diff"])
        print(f"- {a}: {len(sig)} of {len(s['arms'][a]['slices_worse_than_1pt'])}" + (". Worst: " + ", ".join(f"{w['slice']} +{w['diff']:.1f}" for w in sig[:4]) if sig else ""))
    print()
    print("Invented tokens on the noise-only clips per language (en, it, ru, ro words; ja characters):")
    print()
    print("| arm | " + " | ".join(LANGS) + " | sum |")
    print("|---|" + "---|" * (len(LANGS) + 1))
    for a in ["raw"] + arms:
        t = s["raw"]["noise_only_tokens"] if a == "raw" else s["arms"][a]["noise_only_tokens"]
        print(f"| {a} | " + " | ".join(str(t[lang]) for lang in LANGS) + f" | {sum(t.values())} |")


if __name__ == "__main__":
    main()
