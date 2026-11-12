"""Step C: pin every candidate file (source, revision, size, sha256 computed here, licences).

The git repositories are cloned at their pinned commits under WORK/models/src/<name> beforehand
(git clone --filter=blob:none --no-checkout, then checkout of the commit). This script copies the
exact model files into WORK/models/<name>/ (one new folder each), downloads the files that live
elsewhere, and writes manifest/models.json. Nothing downloaded is executed here.

Usage: python -I 04_fetch_models.py
"""
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import MANIFEST, WORK, sha256_file, write_json

SRC = WORK / "models" / "src"
RNNOISE_MODEL = "0a8755f8e2d834eff6a54714ecc7d75f9932e845df35f8b59bc52a7cfe6e8b37"  # rnnoise/model_version at 70f1d25
HF = "https://huggingface.co/{repo}/resolve/{rev}/{path}"

CANDIDATES = [
    {"name": "gtcrn", "source": "https://github.com/Xiaobin-Rong/gtcrn", "revision": "502ebfab64da7c4a9af78dcb9c6ceef1ebb01c73",
     "code_licence": "MIT (LICENSE)", "weight_licence": "MIT: the weights are files of the MIT-licensed repository (stream/onnx_models)",
     "sample_rate": 16000, "runtime": "onnxruntime",
     "files": [("repo", "gtcrn", "stream/onnx_models/gtcrn_simple.onnx")]},
    {"name": "dtln", "source": "https://github.com/breizhn/DTLN", "revision": "1de1f15a8b5b7e1c44905618ff2ef70ca8277fbc",
     "code_licence": "MIT (LICENSE)", "weight_licence": "MIT: pretrained_model/ is part of the MIT-licensed repository",
     "sample_rate": 16000, "runtime": "onnxruntime",
     "files": [("repo", "dtln", "pretrained_model/model_1.onnx"), ("repo", "dtln", "pretrained_model/model_2.onnx")]},
    {"name": "dpdfnet2", "source": "https://huggingface.co/Ceva-IP/DPDFNet", "revision": "dd6818d00f50c836fed43a6243ebe49116de5964",
     "code": "https://github.com/ceva-ip/DPDFNet @ 9bd9844a227bb6aa57e55588d8d0e961fcff1c46",
     "code_licence": "Apache-2.0 (LICENSE)", "weight_licence": "Apache-2.0 (Hugging Face model card licence field)",
     "sample_rate": 16000, "runtime": "onnxruntime",
     "files": [("hf", "Ceva-IP/DPDFNet", "onnx/dpdfnet2.onnx")]},
    {"name": "dpdfnet2_48k", "source": "https://huggingface.co/Ceva-IP/DPDFNet", "revision": "dd6818d00f50c836fed43a6243ebe49116de5964",
     "code": "https://github.com/ceva-ip/DPDFNet @ 9bd9844a227bb6aa57e55588d8d0e961fcff1c46",
     "code_licence": "Apache-2.0 (LICENSE)", "weight_licence": "Apache-2.0 (Hugging Face model card licence field)",
     "sample_rate": 48000, "runtime": "onnxruntime",
     "files": [("hf", "Ceva-IP/DPDFNet", "onnx/dpdfnet2_48khz_hr.onnx")]},
    {"name": "dfn3", "source": "https://github.com/Rikorose/DeepFilterNet", "revision": "7b14b895fe7fc42cab72b4a4c1e49c982bd6404b",
     "code_licence": "MIT OR Apache-2.0 (LICENSE, LICENSE-MIT, LICENSE-APACHE)",
     "weight_licence": "MIT OR Apache-2.0: models/ is part of the dual-licensed repository",
     "sample_rate": 48000, "runtime": "deep-filter 0.5.6 (the project's Rust binary, tract)",
     "files": [("repo", "deepfilternet", "models/DeepFilterNet3_onnx.tar.gz"), ("repo", "deepfilternet", "models/DeepFilterNet3_ll_onnx.tar.gz"),
               ("url", "https://github.com/Rikorose/DeepFilterNet/releases/download/v0.5.6/deep-filter-0.5.6-x86_64-pc-windows-msvc.exe", "deep-filter-0.5.6-x86_64-pc-windows-msvc.exe")]},
    {"name": "rnnoise", "source": "https://github.com/xiph/rnnoise", "revision": "70f1d256acd4b34a572f999a05c87bf00b67730d",
     "code_licence": "BSD-3-Clause (COPYING)",
     "weight_licence": "BSD-3-Clause header in the generated src/rnnoise_data.c inside the tarball (checked after unpacking); tarball sha256 pinned by model_version in the repository",
     "sample_rate": 48000, "runtime": "C, built here with MSVC 2019 Build Tools",
     "files": [("url", f"https://media.xiph.org/rnnoise/models/rnnoise_data-{RNNOISE_MODEL}.tar.gz", f"rnnoise_data-{RNNOISE_MODEL}.tar.gz")]},
    {"name": "hush", "source": "https://huggingface.co/weya-ai/hush", "revision": "a55d932cbf6344d284ac985f21e7f6e5bc4d38a5",
     "code": "https://github.com/pulp-vision/Hush @ 9f6414e91461a8f4bdf9840c0cdcdcb7da986339",
     "code_licence": "Apache-2.0 (LICENSE)", "weight_licence": "Apache-2.0 (Hugging Face model card licence field and LICENSE in the model repository)",
     "sample_rate": 16000, "runtime": "DeepFilterNet-style three-graph bundle (needs libDF processing)",
     "files": [("hf", "weya-ai/hush", "onnx/advanced_dfnet16k_model_best_onnx.tar.gz")]},
]


def main():
    out = []
    for c in CANDIDATES:
        dest = WORK / "models" / c["name"]
        dest.mkdir(parents=True, exist_ok=True)
        files = []
        for kind, a, b in c["files"]:
            if kind == "repo":
                target = dest / Path(b).name
                if not target.exists():
                    shutil.copyfile(SRC / a / b, target)
                origin = f"{c['source']}/blob/{c['revision']}/{b}"
            else:
                url = HF.format(repo=a, rev=c["revision"], path=b) if kind == "hf" else a
                target = dest / Path(b).name
                if not target.exists():
                    subprocess.run(["curl.exe", "-sSL", "--fail", "--retry", "5", "-o", str(target) + ".part", url], check=True)
                    Path(str(target) + ".part").rename(target)
                origin = url
            files.append({"file": target.name, "origin": origin, "bytes": target.stat().st_size, "sha256": sha256_file(target)})
            print(c["name"], target.name, target.stat().st_size, flush=True)
        out.append({k: v for k, v in c.items() if k != "files"} | {"files": files})
    write_json(MANIFEST / "models.json", {"pinned_on": "2026-11-12", "candidates": out})


if __name__ == "__main__":
    main()
