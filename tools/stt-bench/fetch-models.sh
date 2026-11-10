#!/usr/bin/env bash
# Downloads sherpa-onnx model archives from the official k2-fsa release page for the measurements in
# docs/stt/LANGUAGES.md. Each archive goes into its own new folder under <root>, its size and SHA-256
# are appended to <root>/models.tsv, and it is unpacked there (data only: nothing in it is executed).
# Usage: fetch-models.sh <root> [<asset-name> ...]   (no names: every line of models.txt next to this script)
set -u
BASE="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models"
ROOT="$1"; shift
mkdir -p "$ROOT"
if [ "$#" -eq 0 ]; then set -- $(tr -d '\r' < "$(dirname "$0")/models.txt"); fi
for asset in "$@"; do
  name="${asset%.tar.bz2}"
  name="${name%.onnx}"
  dir="$ROOT/$name"
  if [ -f "$dir/.done" ]; then echo "skip $asset"; continue; fi
  mkdir -p "$dir"
  cd "$dir" || exit 1
  if ! curl -sS -L --fail --retry 5 --retry-delay 3 -C - -o "$asset" "$BASE/$asset"; then echo "FAILED $asset"; continue; fi
  size=$(stat -c %s "$asset")
  sha=$(sha256sum "$asset" | cut -d' ' -f1)
  case "$asset" in
    *.tar.bz2) tar -xjf "$asset" || { echo "EXTRACT FAILED $asset"; continue; } ;;
  esac
  printf '%s\t%s\t%s\t%s\n' "$asset" "$size" "$sha" "$BASE/$asset" >> "$ROOT/models.tsv"
  touch .done
  echo "ok $asset $size $sha"
done
