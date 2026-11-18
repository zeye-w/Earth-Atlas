#!/usr/bin/env bash
# Encode the intro video from the ascent frames rendered from the app's globe.
#
#   video/intro/assemble.sh <frames dir> <out dir>
#
# Output: intro.mp4 (1080p H.264, fast start), poster.jpg (first frame),
# end.jpg (last frame) and sheet.jpg (contact sheet for review).
set -euo pipefail
frames=$1; out=$2
mkdir -p "$out"
W=1920; H=1080; FPS=30
fit="scale=$W:$H:force_original_aspect_ratio=increase,crop=$W:$H,fps=$FPS,format=yuv420p,setsar=1"
tmp=$(mktemp -d)

ffmpeg -v error -y -framerate $FPS -i "$frames/f%04d.png" -vf "$fit" -c:v libx264 -crf 14 -preset medium "$tmp/ascent.mp4"

# The ascent emerges from white haze.
ffmpeg -v error -y -i "$tmp/ascent.mp4" -vf "fade=t=in:st=0:d=0.5:color=white" -c:v libx264 -crf 14 "$tmp/joined.mp4"

# Delivery: sharp 1080p (the globe fills large screens), about 3 MB for the short clip, no audio, index at the front so playback starts while downloading.
ffmpeg -v error -y -i "$tmp/joined.mp4" -an -c:v libx264 -profile:v high -preset slow -crf 19 -maxrate 9000k -bufsize 18000k -pix_fmt yuv420p -movflags +faststart "$out/intro.mp4"
ffmpeg -v error -y -i "$out/intro.mp4" -frames:v 1 -q:v 4 "$out/poster.jpg"
ffmpeg -v error -y -sseof -0.1 -i "$out/intro.mp4" -frames:v 1 -q:v 3 -update 1 "$out/end.jpg"
ffmpeg -v error -y -i "$out/intro.mp4" -vf "fps=2,scale=320:-1,tile=6x4" -frames:v 1 -q:v 4 "$out/sheet.jpg"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$out/intro.mp4"
rm -rf "$tmp"
