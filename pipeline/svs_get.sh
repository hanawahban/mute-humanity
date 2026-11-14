#!/usr/bin/env bash
# Download SVS media for the given ids into public/eic/<id>/.
#   pipeline/svs_get.sh 3912 5149 5011 5313 5121 5154
# Per id: api.json, the largest still Image <= 40 MP (no thm/searchweb/web, no colorbars, no tif),
# every colorbar image (cbar/colorbar in name, plus extra_for below), and one MP4 <= 1080p
# (never mov/ProRes, never Frames folders). Existing files are skipped; failures are logged and skipped.
set -u
cd "$(dirname "$0")/.."
OUT=public/eic
LOG=pipeline/logs/svs_get.log
mkdir -p "$OUT" pipeline/logs

# files that are legends/colorbars but do not match the cbar/colorbar rule (confirmed by looking at the file list)
extra_for() { case "$1" in 5154) echo "NitrousOxides_GMAO.png";; esac; }   # bash 3 safe (macOS)

https() { sed 's#^http://#https://#'; }

get() {  # get <url> <dest>
  local url="$1" dest="$2"
  if [ -s "$dest" ]; then echo "  skip  $dest"; return 0; fi
  mkdir -p "$(dirname "$dest")"
  if curl -L --fail -s --retry 2 --max-time 3600 -o "$dest.part" "$url"; then
    mv "$dest.part" "$dest"; echo "  ok    $dest ($(du -h "$dest" | cut -f1))"
  else
    rm -f "$dest.part"; echo "  FAIL  $url" | tee -a "$LOG"
  fi
}

PX='((.width // 0) * (.height // 0))'
for id in "$@"; do
  echo "== $id"
  api="$OUT/$id/api.json"
  get "https://svs.gsfc.nasa.gov/api/$id" "$api"
  [ -s "$api" ] || continue
  IMG='.media_groups[]?.items[]?.instance | select(.media_type=="Image")'

  # largest still image <= 40 MP
  url=$(jq -r "[$IMG | select((.filename|test(\"_thm|searchweb|_web\\\\.\";\"i\"))|not)
      | select((.filename|test(\"cbar|colorbar\";\"i\"))|not)
      | select(.filename|test(\"\\\\.(jpg|jpeg|png)\$\";\"i\"))
      | select($PX <= 40000000)] | sort_by(-$PX) | .[0].url // empty" "$api" | https)
  if [ -n "$url" ]; then get "$url" "$OUT/$id/$(basename "$url")"; else echo "  no still image" | tee -a "$LOG"; fi

  # colorbars
  jq -r "$IMG | select(.filename|test(\"cbar|colorbar\";\"i\")) | .url" "$api" | https | sort -u |
    while read -r u; do [ -n "$u" ] && get "$u" "$OUT/$id/$(basename "$u")"; done
  for f in $(extra_for "$id"); do
    u=$(jq -r --arg f "$f" "$IMG | select(.filename==\$f) | .url" "$api" | https | head -1)
    [ -n "$u" ] && get "$u" "$OUT/$id/$f"
  done

  # one MP4 <= 1080p (height from metadata, else from "NNNNp" in the filename)
  url=$(jq -r '[.media_groups[]?.items[]?.instance | select(.media_type=="Movie")
      | select(.filename|test("\\.mp4$";"i")) | select((.filename|test("prores";"i"))|not)
      | select( ((.height // 0) as $h | if $h > 0 then $h <= 1080
                  else ((.filename | capture("(?<p>[0-9]{3,4})p")? | .p | tonumber) // 0) <= 1080 end) )]
      | sort_by(-((.width // 0) * (.height // 0))) | .[0].url // empty' "$api" | https)
  if [ -n "$url" ]; then get "$url" "$OUT/$id/$(basename "$url")"; else echo "  no mp4 <= 1080p" | tee -a "$LOG"; fi
done
