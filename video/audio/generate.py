"""Reproducible original TerraScope score. Requires Python 3 and numpy.

Run: python video/audio/generate.py
No recordings, samples, pretrained models, or third-party compositions are used.
"""
from pathlib import Path
import json
import wave
import numpy as np

ROOT = Path(__file__).resolve().parent
spec = json.loads((ROOT.parent / 'shots.json').read_text(encoding='utf-8'))
SR = 48000
duration = spec['output']['duration']
t = np.arange(round(duration * SR)) / SR
mix = np.zeros((len(t), 2), dtype=np.float64)
rng = np.random.default_rng(20261020)

def add(signal, pan=0.0):
    mix[:, 0] += signal * np.sqrt((1-pan)/2)
    mix[:, 1] += signal * np.sqrt((1+pan)/2)

def note(hz, start, length, level, pan=0):
    x = np.maximum(t-start, 0)
    env = np.clip(x/.35, 0, 1) * np.clip((length-x)/1.2, 0, 1) * (t >= start)
    signal = sum(np.sin(2*np.pi*hz*(1+d)*x + .08*np.sin(.3*x)) * w
                 for d, w in [(-.0015,.42),(.0015,.42),(0,.16)])
    add(signal * env * level, pan)

# Original slow-moving D-minor/add9 voicings; deliberately sparse and calm.
for start, length, pitches in [(0,10,[146.832,220,293.665,329.628]),
                               (7,10,[130.813,196,261.626,293.665]),
                               (14,11,[116.541,174.614,261.626,349.228]),
                               (22,8,[146.832,220,293.665,440])]:
    for index,hz in enumerate(pitches):
        note(hz,start,length,.038,(-.65,-.2,.2,.65)[index])
note(73.416,0,30,.055)

# 105 BPM soft bass pulse enters precisely with the second shot.
beat=60/105
for k,start in enumerate(np.arange(3,27.6,beat)):
    x=t-start
    env=np.exp(-np.maximum(x,0)*9)*(x>=0)*(x<.65)
    sweep=2*np.pi*(65*x+30*(1-np.exp(-np.maximum(x,0)*18))/18)
    add(np.sin(sweep)*env*(.11 if k%4==0 else .065))
    if k%2:
        add(np.sin(2*np.pi*587.33*x)*np.exp(-np.maximum(x,0)*18)*(x>=0)*(x<.4)*.025,.35)

# Deterministic filtered noise sweeps at editorial transition cues.
noise=rng.normal(0,1,len(t))
soft=np.convolve(noise,np.ones(18)/18,mode='same')
for cue in [3,6.5,13.5,21.5]:
    env=np.exp(-((t-(cue-.04))/.19)**2)
    add(soft*env*.08,-.25)
    add(np.roll(soft,270)*env*.08,.25)

for hz,offset,amp in [(880,0,.045),(1320,.09,.025)]:
    x=t-13.9-offset
    add(np.sin(2*np.pi*hz*x)*np.exp(-np.maximum(x,0)*12)*(x>=0)*(x<.7)*amp,.15)

# Product reveal lift and a restrained final D resolution.
for cue,level in [(25,.07),(27.6,.10)]:
    for hz,pan in [(146.832,-.3),(293.665,.3),(440,0)]:
        x=t-cue
        add(np.sin(2*np.pi*hz*x)*np.exp(-np.maximum(x,0)*1.4)*(x>=0)*level,pan)

fade=np.clip(t/1.4,0,1)*np.clip((duration-t)/.65,0,1)
mix*=fade[:,None]
# Conservative sample peak; final true-peak / LUFS mastering is a separate step.
mix*=.63/np.max(np.abs(mix))
pcm=np.round(mix*32767).astype('<i2')
dest=ROOT/'terrascope-original.wav'
with wave.open(str(dest),'wb') as out:
    out.setnchannels(2); out.setsampwidth(2); out.setframerate(SR)
    out.writeframes(pcm.tobytes())
print(f'{dest}: {len(t)/SR:.3f}s, {SR} Hz stereo PCM16, sample peak {20*np.log10(np.max(np.abs(mix))):.2f} dBFS')
