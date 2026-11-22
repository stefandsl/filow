"""Build the offline verb index. Pass a directory containing the four upstream inputs."""
import gzip
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from zipfile import ZipFile

inputs = Path(sys.argv[1])
output = Path(__file__).resolve().parents[1] / "apps/desktop/daily-lexicon"
output.mkdir(exist_ok=True)
digests = {
    "wordnet.zip": "cbda5ea6eef7f36a97a43d4a75f85e07fccbb4f23657d27b4ccbc93e2646ab59",
    "omw.zip": "3b941e664852f3297b6040236626065796a2aaf7d7f9eec8779a3beaa1096c2d",
    "ita": "6347bb15b3d2c3dafcbe4adc0e7beaa97a8bc61bcccc345079afb154c03f1321",
    "eng": "20a191cefdc7cad6fa74b00f49d6f658684f17b14541aae372e5a3d5a8c15c67",
}
for name, digest in digests.items():
    if hashlib.sha256((inputs / name).read_bytes()).hexdigest() != digest:
        raise ValueError("Unexpected input hash for " + name)

senses = defaultdict(set)
human_target_senses = set()
role_senses = set()
roles = set()
nouns = set()
with ZipFile(inputs / "wordnet.zip") as archive:
    license_text = archive.read("wordnet/LICENSE").decode()
    (output / "wordnet-license.txt").write_text("\n".join(line.rstrip() for line in license_text.splitlines()) + "\n", encoding="utf8")
    tagged = {"1": Counter(), "2": Counter()}
    for line in archive.read("wordnet/index.sense").decode().splitlines():
        key, _, _, frequency = line.split()
        word, sense = key.split("%", 1)
        if sense[0] in tagged:
            tagged[sense[0]][word] += int(frequency)
    for line in archive.read("wordnet/data.noun").decode().splitlines():
        fields = line.split()
        if line.startswith(" "):
            continue
        words = {w for w in fields[4:4 + 2 * int(fields[3], 16):2] if w.isalpha()}
        nouns.update(words)
        if fields[1] != "18" and "person" not in words:
            continue
        role_senses.add(fields[0])
        roles.update(words)
    for line in archive.read("wordnet/data.verb").decode().splitlines():
        if line.startswith(" "):
            continue
        fields = line.split()
        if "+ 09 " in line.partition("|")[0]:  # Somebody verbs somebody
            human_target_senses.add(int(fields[0]))
        for word in fields[4:4 + 2 * int(fields[3], 16):2]:
            if word.isalpha():
                senses[word].add(int(fields[0]))
with ZipFile(inputs / "omw.zip") as archive:
    for line in archive.read("omw-1.4/ita/wn-data-ita.tab").decode().splitlines():
        fields = line.split("\t")
        if len(fields) != 3 or fields[1] != "ita:lemma" or not fields[2].isalpha():
            continue
        if fields[0].endswith("-v"):
            senses[fields[2]].add(int(fields[0][:-2]))
        elif fields[0].endswith("-n"):
            nouns.add(fields[2])
            if fields[0][:-2] in role_senses:
                roles.add(fields[2])

# Index only morphology that can express an instruction or a completed action.
index = {key: defaultdict(set) for key in ["past", "participle", "imperative", "gerund"]}
for lang in ("ita", "eng"):
    for line in (inputs / lang).read_text(encoding="utf8").splitlines():
        fields = line.split("\t")
        if len(fields) != 3:
            continue
        lemma, form, tags = fields
        if not form.isalpha() or not lemma.isalpha() or not tags.startswith("V"):
            continue
        if lang == "ita" and lemma.endswith("si"):
            continue  # reflexive lemmas need their own argument structure
        if "V.PTCP" in tags and "PST" in tags:
            index["participle"][form].add(lemma)
        if tags == "V;PST" or tags.startswith("V;IND;PST;1;") and tags.endswith(";PFV"):
            index["past"][form].add(lemma)
        if ";IMP;" in tags and ";2;" in tags:
            index["imperative"][form].add(lemma)
        if "V.PTCP;PRS" in tags and lang == "eng":
            index["gerund"][form].add(lemma)
        if lang == "eng" or tags == "V;NFIN":
            index["imperative"][lemma].add(lemma)
index["senses"] = senses
packed = {key: {k: sorted(v) for k, v in entries.items()} for key, entries in index.items()}
packed["humanTarget"] = sorted(word for word, ids in senses.items() if ids & human_target_senses)
packed["roles"] = sorted(roles)
packed["nouns"] = sorted(nouns)
packed["primarilyVerb"] = sorted(word for word, count in tagged["2"].items() if count > tagged["1"][word])
data = json.dumps(packed, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
with (output / "verbs.json.gz").open("wb") as stream, gzip.GzipFile(filename="", fileobj=stream, mode="wb", mtime=0) as zipped:
    zipped.write(data)
