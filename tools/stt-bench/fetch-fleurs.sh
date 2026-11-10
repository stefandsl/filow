#!/usr/bin/env bash
# Fetches a few FLEURS dev clips per language (google/fleurs on Hugging Face, CC-BY-4.0) for the
# measurements in docs/stt/LANGUAGES.md. Only the first <bytes> of each dev.tar.gz are downloaded (an
# HTTP Range request): the tar is read as far as it goes, so no full 200-300 MB archive is needed.
# Each language goes into its own new folder under <root>; URL, size and SHA-256 of what was
# downloaded are appended to <root>/audio.tsv.
# Usage: fetch-fleurs.sh <root> <bytes> <fleurs-config> [<fleurs-config> ...]   (configs: en_us it_it ru_ru ro_ro ja_jp)
set -u
BASE="https://huggingface.co/datasets/google/fleurs/resolve/main/data"
ROOT="$1"; BYTES="$2"; shift 2
mkdir -p "$ROOT"
for cfg in "$@"; do
  dir="$ROOT/fleurs-$cfg"
  if [ -f "$dir/.done" ]; then echo "skip $cfg"; continue; fi
  mkdir -p "$dir"
  cd "$dir" || exit 1
  curl -sS -L --fail --retry 5 -o dev.tsv "$BASE/$cfg/dev.tsv" || { echo "FAILED $cfg tsv"; continue; }
  curl -sS -L --fail --retry 5 -r "0-$((BYTES - 1))" -o dev.head.tar.gz "$BASE/$cfg/audio/dev.tar.gz" || { echo "FAILED $cfg audio"; continue; }
  # The archive is cut short on purpose: tar stops with an error at the cut, after the whole clips.
  tar -xzf dev.head.tar.gz 2>/dev/null
  # The last file may be cut: drop it.
  last=$(tar -tzf dev.head.tar.gz 2>/dev/null | grep '\.wav$' | tail -1)
  [ -n "$last" ] && rm -f "$last"
  for f in dev.tsv dev.head.tar.gz; do
    printf '%s\t%s\t%s\t%s\tCC-BY-4.0\n' "fleurs-$cfg/$f" "$(stat -c %s "$f")" "$(sha256sum "$f" | cut -d' ' -f1)" "$BASE/$cfg/$([ "$f" = dev.tsv ] && echo dev.tsv || echo audio/dev.tar.gz) (first $BYTES bytes for the audio)" >> "$ROOT/audio.tsv"
  done
  touch .done
  echo "ok $cfg $(ls dev/*.wav 2>/dev/null | wc -l) clips"
done
