#!/usr/bin/env bash
# Assemble the intro video: optional ground-level clips (clip1/2/3.mp4, AI
# generated or licensed footage, supplied by the project owner) cross-faded
# into the ascent rendered from the app's globe.
#
#   video/intro/assemble.sh <frames dir> <clips dir or ""> <out dir>
#
# Output: intro.mp4 (720p H.264, fast start), poster.jpg (first frame),
# end.jpg (last frame) and sheet.jpg (contact sheet for review).
set -euo pipefail
frames=$1; clips=${2:-}; out=$3
mkdir -p "$out"
W=1280; H=720; FPS=30
fit="scale=$W:$H:force_original_aspect_ratio=increase,crop=$W:$H,fps=$FPS,format=yuv420p,setsar=1"
tmp=$(mktemp -d)

ffmpeg -v error -y -framerate $FPS -i "$frames/f%04d.png" -vf "$fit" -c:v libx264 -crf 14 -preset medium "$tmp/ascent.mp4"

# Seconds kept from each clip, and cross-fade lengths (the last one, out of
# the white cloud that ends clip 3 into the ascent, is longer).
KEEP=(3.2 3.2 2.4); FADE=0.4; LAST_FADE=0.7
inputs=(); n=0
if [ -n "$clips" ]; then
  for i in 1 2 3; do
    f="$clips/clip$i.mp4"
    [ -f "$f" ] || continue
    ffmpeg -v error -y -i "$f" -t "${KEEP[$((i-1))]}" -an -vf "$fit" -c:v libx264 -crf 14 -preset medium "$tmp/c$n.mp4"
    inputs+=("$tmp/c$n.mp4"); n=$((n+1))
  done
fi

if [ "$n" -eq 0 ]; then
  # No ground footage yet: the ascent alone, emerging from white cloud.
  ffmpeg -v error -y -i "$tmp/ascent.mp4" -vf "fade=t=in:st=0:d=0.8:color=white" -c:v libx264 -crf 14 "$tmp/joined.mp4"
else
  inputs+=("$tmp/ascent.mp4")
  args=(); for f in "${inputs[@]}"; do args+=(-i "$f"); done
  filter=""; prev="[0:v]"; offset=0
  for ((k=1; k<=n; k++)); do
    d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "${inputs[$((k-1))]}")
    fade=$FADE; [ "$k" -eq "$n" ] && fade=$LAST_FADE
    offset=$(awk -v o="$offset" -v d="$d" -v f="$fade" 'BEGIN{printf "%.3f", o + d - f}')
    filter+="${prev}[$k:v]xfade=transition=fade:duration=$fade:offset=$offset[v$k];"
    prev="[v$k]"
  done
  ffmpeg -v error -y "${args[@]}" -filter_complex "${filter%;}" -map "$prev" -c:v libx264 -crf 14 "$tmp/joined.mp4"
fi

# Delivery: about 2.5 Mbit/s at 720p, no audio, index at the front so playback starts while downloading.
ffmpeg -v error -y -i "$tmp/joined.mp4" -an -c:v libx264 -profile:v high -preset slow -crf 24 -maxrate 3500k -bufsize 7000k -pix_fmt yuv420p -movflags +faststart "$out/intro.mp4"
ffmpeg -v error -y -i "$out/intro.mp4" -frames:v 1 -q:v 4 "$out/poster.jpg"
ffmpeg -v error -y -sseof -0.1 -i "$out/intro.mp4" -frames:v 1 -q:v 3 -update 1 "$out/end.jpg"
ffmpeg -v error -y -i "$out/intro.mp4" -vf "fps=2,scale=320:-1,tile=6x4" -frames:v 1 -q:v 4 "$out/sheet.jpg"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$out/intro.mp4"
rm -rf "$tmp"
