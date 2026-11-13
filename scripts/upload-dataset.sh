#!/usr/bin/env bash
# Uploads a folder (recursively) to R2 with the wrangler CLI, many files in parallel, resumable.
#
#   scripts/upload-dataset.sh /path/to/dataset            # -> bimp-files/dataset/<relative path>
#   JOBS=16 PREFIX=dataset scripts/upload-dataset.sh /path/to/dataset
#
# Log in first with `npx wrangler login` (or set CLOUDFLARE_API_TOKEN). Re-run the same command to resume:
# files listed in .upload-done.txt are skipped. Failures go to .upload-failed.txt (re-running retries them).
# Wrangler uploads files up to 300 MiB; larger ones are listed in .upload-too-big.txt and skipped.
set -euo pipefail

SRC="${1:?usage: $0 /path/to/folder}"
SRC="$(cd "$SRC" && pwd)"
BUCKET="${BUCKET:-bimp-files}"
PREFIX="${PREFIX:-dataset}"
JOBS="${JOBS:-8}"
STATE="$(pwd)"
DONE="$STATE/.upload-done.txt"; FAILED="$STATE/.upload-failed.txt"; BIG="$STATE/.upload-too-big.txt"
touch "$DONE"; : > "$FAILED"; : > "$BIG"
WRANGLER="$(cd "$(dirname "$0")/.." && pwd)/node_modules/.bin/wrangler"
[ -x "$WRANGLER" ] || WRANGLER="npx wrangler"
LIMIT=$((300 * 1024 * 1024))

total=$(find "$SRC" -type f ! -name '.*' | wc -l | tr -d ' ')
already=$(wc -l < "$DONE" | tr -d ' ')
echo "Uploading $total files from $SRC to r2://$BUCKET/$PREFIX/ with $JOBS parallel jobs ($already already done)"

upload_one() {
  f="$1"
  rel="${f#"$SRC"/}"
  grep -Fxq -- "$rel" "$DONE" && return 0
  size=$(wc -c < "$f" | tr -d ' ')
  if [ "$size" -gt "$LIMIT" ]; then echo "$rel ($size bytes)" >> "$BIG"; return 0; fi
  for attempt in 1 2 3; do
    if $WRANGLER r2 object put "$BUCKET/$PREFIX/$rel" --file "$f" --remote >/dev/null 2>&1; then
      echo "$rel" >> "$DONE"; echo "ok  $rel"; return 0
    fi
    sleep $((attempt * 3))
  done
  echo "$rel" >> "$FAILED"; echo "FAIL $rel"
}
export -f upload_one
export SRC BUCKET PREFIX DONE FAILED BIG WRANGLER LIMIT

find "$SRC" -type f ! -name '.*' -print0 | xargs -0 -n 1 -P "$JOBS" bash -c 'upload_one "$0"'

echo
echo "Done: $(wc -l < "$DONE" | tr -d ' ') of $total uploaded."
[ -s "$FAILED" ] && echo "Failed: $(wc -l < "$FAILED" | tr -d ' ') (see .upload-failed.txt) — run the same command again to retry."
[ -s "$BIG" ] && echo "Too big for wrangler (> 300 MiB): $(wc -l < "$BIG" | tr -d ' ') (see .upload-too-big.txt)."
exit 0
