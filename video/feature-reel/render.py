"""Render a 30-second 1080p/30fps Terrascope promo from real website frame samples.

NOTE: Between recorded frames, the gentle pan/dissolve is an editorial
motion effect, NOT actual measured motion of aircraft, satellites, or aurora.
"""
import json
import math
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "video/feature-reel/out"
manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
assert not manifest["errors"], "Incomplete actual-data capture; refusing to render"
chapters = manifest["chapters"]
assert len(chapters) == 5 and all(len(c["capture"]) == 3 for c in chapters), "Missing frames"

W, H, FPS = 1920, 1080, 30
SECTION = 162          # 5.4 s × 5 = 27s
ENDING = 90            # 3 s brand card
TOTAL = SECTION * 5 + ENDING
FONT_SC = ROOT / "video/audio/fonts/NotoSansSC-variable.ttf"
FONT_INTER = ROOT / "video/audio/fonts/Inter-variable.ttf"
large = ImageFont.truetype(str(FONT_SC), 58)
medium = ImageFont.truetype(str(FONT_SC), 30)
small = ImageFont.truetype(str(FONT_SC), 21)
latin = ImageFont.truetype(str(FONT_INTER), 21)
tiny = ImageFont.truetype(str(FONT_INTER), 17)
logo = ImageFont.truetype(str(FONT_INTER), 84)

HEADINGS = [
    ("轨道之上", "精选卫星 · SGP4 轨道推算", "CELESTRAK GP / PREDICTED ORBITS"),
    ("星链星座", "Starlink · 公开轨道根数 · SGP4", "CELESTRAK / STARLINK CONSTELLATION"),
    ("地球上空的航班", "ADS-B 广播观测 · 仅限接收网络覆盖", "ADS-B / ADSB.LOL OR OPENSKY"),
    ("太阳风与磁层", "NOAA 实测驱动 · Shue (1998) 磁层顶模型", "NOAA SWPC / MODEL-BASED VISUALIZATION"),
    ("极光的动态预报", "NOAA OVATION · 极光概率预报，并非实况", "NOAA OVATION / FORECAST, NOT FOOTAGE"),
]
if chapters[4].get("dataAvailability") == "quiet":
    HEADINGS[4] = ("极光预报", "当前极光活动较弱 · NOAA OVATION 概率预报", "FORECAST ACTIVITY LOW / NOT AN OBSERVATION")

images = [[Image.open(OUT / f).convert("RGB") for f in c["capture"]] for c in chapters]

def overlay_for(idx):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for y in range(620, H, 4):
        alpha = int(173 * ((y-620)/(H-620)) ** .75)
        d.rectangle((0, y, W, y+4), fill=(3, 8, 18, alpha))
    d.text((76, 55), "T E R R A S C O P E", font=latin, fill=(235, 240, 247, 226))
    d.line((77, 99, 230, 99), fill=(142, 180, 211, 215), width=2)
    title, desc, source = HEADINGS[idx]
    d.text((82, 783), "%02d  /  05" % (idx + 1), font=latin, fill=(155, 184, 207, 235))
    d.text((80, 825), title, font=large, fill=(248, 250, 252, 255), stroke_width=1)
    d.text((82, 919), desc, font=medium, fill=(227, 236, 242, 245))
    d.text((83, 995), source, font=tiny, fill=(165, 193, 215, 220))
    # All source times are factual and recorded in accompanying manifest.
    d.text((1515, 1010), "SCIENCE · DATA · EARTH", font=tiny, fill=(190, 203, 220, 140))
    return layer

overlays = [overlay_for(i) for i in range(5)]
out_file = OUT / "terrascope-five-features-30s.mp4"
audio = ROOT / "video/audio/terrascope-original.wav"
if not audio.exists():
    subprocess.run(["python3", str(ROOT / "video/audio/generate.py")], check=True)

cmd = [
    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", str(W)+"x"+str(H),
    "-r", str(FPS), "-i", "-", "-i", str(audio),
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
    "-pix_fmt", "yuv420p", "-color_primaries", "bt709",
    "-colorspace", "bt709", "-color_trc", "bt709",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart", "-t", "30",
    str(out_file)
]
proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
try:
    for frame in range(TOTAL):
        section = min(5, frame // SECTION)
        local = frame - section * SECTION
        if section < 5:
            progress = local / max(1, SECTION-1)
            index_value = progress * 2
            first_index = min(2, int(index_value))
            second_index = min(2, first_index+1)
            alpha = index_value-first_index
            # Image blending across genuine captures, not synthesized science data.
            base = Image.blend(images[section][first_index], images[section][second_index], alpha)
            # Very subtle editorial camera push (~2%) keeps the science layer legible.
            zoom = 1 + 0.025 * progress
            rw, rh = math.ceil(W*zoom), math.ceil(H*zoom)
            base = base.resize((rw, rh), Image.Resampling.BILINEAR)
            x = (rw-W)//2
            y = (rh-H)//2
            base = base.crop((x,y,x+W,y+H)).convert("RGBA")
            base.alpha_composite(overlays[section])
            # 0.25-s dips hide hard chapter cuts; first shot fades from black.
            dip = 1.
            fade = 8
            if local < fade:
                dip = min(dip, local / fade)
            if local > SECTION-fade-1:
                dip = min(dip, (SECTION-1-local)/fade)
            if dip < 1:
                base = Image.blend(Image.new("RGBA", (W,H), (3,6,12,255)), base, max(0,dip))
            result = base.convert("RGB")
        else:
            result = Image.new("RGB",(W,H),(4,9,18))
            d = ImageDraw.Draw(result)
            p=local/ENDING
            d.ellipse((510,70,1410,970),outline=(33,57,86),width=2)
            d.ellipse((680,240,1240,800),outline=(40,70,101),width=3)
            d.text((W//2,425),"TERRASCOPE",font=logo,anchor="mm",fill=(240,244,249))
            d.text((W//2,530),"一颗地球，五种实时数据视角",font=medium,anchor="mm",fill=(180,208,229))
            d.text((W//2,625),"EARTH · ORBITS · AVIATION · SPACE WEATHER",font=latin,anchor="mm",fill=(171,188,207))
            d.text((W//2,898),"earth-atlas.edwardlab.workers.dev",font=latin,anchor="mm",fill=(225,231,239))
            if p>0.9:
                result=Image.blend(result,Image.new("RGB",(W,H),(2,4,9)),(p-.9)/.1)
        proc.stdin.write(result.tobytes())
        if frame % 90 == 0:
            print("Rendered",round(frame/FPS,1),"seconds",flush=True)
finally:
    proc.stdin.close()
status=proc.wait()
if status: raise RuntimeError("ffmpeg failed: exit "+str(status))

lines=[
("轨道之上","精选卫星 · SGP4 轨道推算"),
("星链星座","Starlink · 公开轨道根数 · SGP4"),
("地球上空的航班","ADS-B 广播观测"),
("太阳风与磁层","NOAA 实测驱动 · Shue (1998) 磁层顶模型"),
("极光预报","NOAA OVATION 概率预报"),
("TERRASCOPE","一颗地球，五种数据视角")
]
def tc(frame):
    ms=round(frame*1000/FPS)
    return f"{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}"
srt="\n".join(str(i+1)+"\n"+tc(i*SECTION)+" --> "+tc((i+1)*SECTION if i<5 else TOTAL)+"\n"+a+"\n"+b+"\n" for i,(a,b) in enumerate(lines))
(OUT/"terrascope-five-features-30s.srt").write_text(srt,encoding="utf-8")
print("DONE",out_file,str(out_file.stat().st_size),"bytes")
