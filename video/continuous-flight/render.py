"""Encode a Terrascope uninterrupted-flight reel from real WebGL camera samples.

30 fps delivery uses strictly cross-frame editorial interpolation between
recorded samples, NOT fabricated intermediate source measurements.
"""
from __future__ import annotations
import json, math, subprocess, collections
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/"video/continuous-flight/out"
src=json.loads((OUT/"manifest.json").read_text(encoding="utf-8"))
assert not src["failures"],"Recording failed; refuse to edit fake footage"
FPS=30
W,H=1920,1080
RATE=int(src["rate"])
DURATION=30
CAP=int(src["duration"])
frames=src["frames"]
assert len(frames)==math.ceil(CAP*RATE),"Incomplete capture"
assert len(src["chapters"])==5,"Missing science feature"
N=FPS*DURATION
FLIGHT_END=CAP*FPS
font_zh=ROOT/"video/audio/fonts/NotoSansSC-variable.ttf"
font_en=ROOT/"video/audio/fonts/Inter-variable.ttf"
head=ImageFont.truetype(str(font_zh),64)
sub=ImageFont.truetype(str(font_zh),30)
label=ImageFont.truetype(str(font_en),23)
small=ImageFont.truetype(str(font_en),18)
big=ImageFont.truetype(str(font_en),105)
CHAPTERS=[
    (0,5,"轨道之上","单颗卫星 · SGP4 轨道推算","CELESTRAK / PREDICTED ORBIT"),
    (5,10,"星链星座","Starlink · 公开轨道根数推算","STARLINK / GP ELEMENTS"),
    (10,16,"地球上空的航班","ADS-B 广播接收 · 覆盖并非全球完整","ADS-B / LIVE RECEIVER NETWORK"),
    (16,22,"太阳风与磁层","NOAA 观测驱动 · Shue 磁层顶模型","NOAA SWPC / MODEL-BASED GEOMETRY"),
    (22,27,"地球夜侧的极光","NOAA OVATION · 概率预报，并非实拍","NOAA OVATION / AURORA FORECAST")
]
# No full-frame cuts: any extra movement is a blend between adjacent
# frames captured from a single continuously moving physical Cesium camera.
cache=collections.OrderedDict()
def get(n):
    n=max(0,min(len(frames)-1,n))
    if n in cache:
        cache.move_to_end(n)
        return cache[n]
    im=Image.open(OUT/frames[n]["file"]).convert("RGB")
    cache[n]=im
    while len(cache)>3:cache.popitem(last=False)
    return im
def smooth(a,b,v):return a+(b-a)*v
def caption(im,t):
    idx=min(4,next((i for i,c in enumerate(CHAPTERS) if c[0]<=t<c[1]),4))
    start,end,title,subtitle,source=CHAPTERS[idx]
    stage=min(1,max(0,(t-start)/0.55))*min(1,max(0,(end-t)/0.45))
    overlay=Image.new("RGBA",(W,H),(0,0,0,0))
    d=ImageDraw.Draw(overlay)
    a=int(255*stage)
    for y in range(665,H,4):
        k=((y-665)/(H-665))**0.7
        d.rectangle((0,y,W,y+4),fill=(2,8,19,int(a*0.65*k)))
    d.text((72,54),"T E R R A S C O P E",font=label,fill=(237,240,246,int(230*stage)))
    d.line((75,96,242,96),fill=(152,184,209,int(200*stage)),width=2)
    d.text((77,794),f"{idx+1:02d} / 05",font=label,fill=(147,180,211,a))
    d.text((72,833),title,font=head,fill=(246,249,252,a))
    d.text((76,935),subtitle,font=sub,fill=(220,231,241,a))
    d.text((77,1013),source,font=small,fill=(171,194,214,int(a*0.85)))
    return Image.alpha_composite(im.convert("RGBA"),overlay).convert("RGB")
def endcard(background,t):
    p=min(1,max(0,(t-27)/1.3))
    im=Image.blend(background,Image.new("RGB",(W,H),(3,8,19)),min(0.91,p*0.91))
    d=ImageDraw.Draw(im)
    a=min(255,int(255*max(0,(t-27.2)/0.85)))
    # Pillow RGB drawing only accepts RGB triplets; composite title opacity
    # via real RGB gradients instead of passing invalid four-channel colors.
    fade=a/255.0
    ink=lambda rgb: tuple(round(smooth(bg,fg,fade)) for bg,fg in zip((8,13,24),rgb))
    d.ellipse((520,63,1398,941),outline=(37,65,98),width=2)
    d.text((W/2,440),"TERRASCOPE",font=big,anchor="mm",fill=ink((242,247,250)))
    d.text((W/2,557),"从地球上空，到空间天气",font=head,anchor="mm",fill=ink((220,232,243)))
    d.text((W/2,649),"ONE EARTH · FIVE WAYS TO EXPLORE",font=label,anchor="mm",fill=ink((176,197,219)))
    d.text((W/2,925),"earth-atlas.edwardlab.workers.dev",font=label,anchor="mm",fill=ink((219,231,242)))
    return im
audio=ROOT/"video/audio/terrascope-original.wav"
if not audio.exists():
    subprocess.run(["python3",str(ROOT/"video/audio/generate.py")],check=True)
target=OUT/"terrascope-continuous-flight-30s.mp4"
cmd=["ffmpeg","-y","-hide_banner","-loglevel","error",
  "-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r",str(FPS),"-i","-",
  "-i",str(audio),"-map","0:v:0","-map","1:a:0",
  "-c:v","libx264","-preset","veryfast","-crf","20",
  "-pix_fmt","yuv420p","-color_range","tv",
  "-color_primaries","bt709","-colorspace","bt709","-color_trc","bt709",
  "-c:a","aac","-b:a","192k","-ar","48000","-ac","2",
  "-movflags","+faststart","-t",str(DURATION),str(target)]
proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
try:
    for i in range(N):
        t=i/FPS
        if i<FLIGHT_END:
            v=min(len(frames)-1-0.00000001,t*RATE)
            lo=int(v)
            hi=min(len(frames)-1,lo+1)
            a=get(lo)
            b=get(hi)
            # Editorial optical blend: no additional location samples invented.
            im=Image.blend(a,b,v-lo) if hi!=lo else a.copy()
            result=caption(im,t)
        else:
            result=endcard(get(len(frames)-1).copy(),t)
        proc.stdin.write(result.tobytes())
        if i%150==0:print("ENCODE",round(t,1),"/ 30 s",flush=True)
finally:
    proc.stdin.close()
if proc.wait()!=0:raise RuntimeError("FFmpeg encoder failed")
def tc(t):
    n=round(t*1000)
    return f"{n//3600000:02d}:{n//60000%60:02d}:{n//1000%60:02d},{n%1000:03d}"
subtitles=[]
for i,(start,end,title,description,source) in enumerate(CHAPTERS):
    subtitles.append(f"{i+1}\n{tc(start)} --> {tc(end)}\n{title}\n{description}\n")
subtitles.append(f"6\n{tc(27)} --> {tc(30)}\nTERRASCOPE\n从地球上空，到空间天气\n")
(OUT/"terrascope-continuous-flight-30s.srt").write_text("\n".join(subtitles),encoding="utf-8")
meta={"source_frames":len(frames),"source_sample_fps":RATE,"source_seconds":CAP,"output_fps":30,"output_seconds":30,"movie":str(target.name),"interpolation":"linear blend between adjacent real website WebGL captured frames","no_fabricated_measurements":True,"audio":"Terrascope original synthesised soundtrack","source_manifest":"manifest.json"}
(OUT/"render-manifest.json").write_text(json.dumps(meta,indent=2,ensure_ascii=False),encoding="utf-8")
print("DELIVERED",target,target.stat().st_size,"bytes")
