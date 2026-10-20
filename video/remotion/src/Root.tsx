import React, {useEffect, useState} from 'react';
import {AbsoluteFill, Audio, Composition, continueRender, delayRender, Img, staticFile, useCurrentFrame} from 'remotion';
import raw from '../../shots.json';
import './style.css';

type Caption = {in:number;out:number;zh:string;en:string;position?:string};
type Shot = {id:string;start:number;end:number;optional?:boolean;type?:string;atmosphereShells?:number;time?:{mode:string;fromHours?:number;toHours?:number};captions?:Caption[];transitionIn?:{type:string;seconds:number};transitionOut?:{type:string;seconds:number};text?:Record<string,string>};
export type Props = {mode:'preview'|'final';auroraShot:'s4-aurora'|'s4b-atmosphere';manifest?:{shots:Record<string,{files:string[]}>};audioSrc?:string};
const spec = raw as unknown as {output:{width:number;height:number;fps:number;duration:number};shots:Shot[]};
const fps=spec.output.fps;
const frames=(seconds:number)=>Math.round(seconds*fps);
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const image=(path:string)=>staticFile(path);
const shotFrames=(shot:Shot)=>frames(shot.end)-frames(shot.start);
function activeShots(props:Props){return spec.shots.filter(s=>s.id==='s4-aurora'||s.id==='s4b-atmosphere'?s.id===props.auroraShot:!s.optional);}

function footageFiles(shot:Shot,props:Props):string[]{
  const explicit=props.manifest?.shots[shot.id]?.files;
  if(explicit?.length)return explicit;
  if(props.mode==='preview')return ['a','b','c'].map(s=>`preview/${shot.id}-${s}.jpg`);
  const count=shot.time?.mode==='hourly-stills'?Math.round((shot.time.toHours??0)-(shot.time.fromHours??0))+1:shotFrames(shot);
  return Array.from({length:count},(_,i)=>`frames/${shot.id}/${String(i).padStart(4,'0')}.png`);
}

function Footage({shot,local,props,last=false}:{shot:Shot;local:number;props:Props;last?:boolean}){
  const files=footageFiles(shot,props);
  const progress=last?1:clamp(local/Math.max(1,shotFrames(shot)-1));
  const dissolve=props.mode==='preview'||shot.time?.mode==='hourly-stills';
  const pos=progress*(files.length-1);
  const index=dissolve?Math.floor(pos):Math.min(files.length-1,Math.max(0,Math.floor(local)));
  const next=Math.min(files.length-1,index+1);
  const scale=shot.time?.mode==='hourly-stills'?1+progress*0.06:1;
  return <AbsoluteFill style={{transform:`scale(${scale})`}}>
    <Img src={image(files[last?files.length-1:index])} style={cover}/>
    {dissolve&&next!==index&&!last&&<Img src={image(files[next])} style={{...cover,opacity:pos-index}}/>}
  </AbsoluteFill>;
}
const cover:React.CSSProperties={width:'100%',height:'100%',objectFit:'cover',position:'absolute'};

function Captions({shot,local}:{shot:Shot;local:number}){
  return <>{shot.atmosphereShells&&<div style={{position:'absolute',right:60,top:70,fontSize:20,opacity:.8}}>大气高度 ×{shot.atmosphereShells} 示意 / ATMOSPHERE HEIGHT ×{shot.atmosphereShells} · ILLUSTRATION</div>}{shot.captions?.map((c,i)=>{
    const start=frames(c.in),end=frames(c.out);
    if(local<start||local>=end)return null;
    const opacity=Math.min(clamp((local-start)/8),clamp((end-local)/8));
    return <div key={i} className={`caption ${c.position??'lower-center'}`} style={{opacity,transform:`translateY(${(1-clamp((local-start)/8))*6}px)`}}>
      <div className="zh">{c.zh}</div><div className="en">{c.en}</div>
    </div>;
  })}</>;
}

function EndCard({shot,local,previous,props}:{shot:Shot;local:number;previous:Shot;props:Props}){
  const p=clamp(local/frames(shot.transitionIn?.seconds??0));
  const text=shot.text!;
  const enter=(delay:number)=>({opacity:clamp((local-delay)/8),transform:`translateY(${(1-clamp((local-delay)/8))*6}px)`});
  return <AbsoluteFill>
    <AbsoluteFill style={{filter:`blur(${p*12}px)`,opacity:1-p*0.65}}><Footage shot={previous} local={shotFrames(previous)-1} last props={props}/></AbsoluteFill>
    <div className="endcard" style={{opacity:p}}>
      <div className="logo" style={enter(0)}><span>TERRA</span><b>SCOPE</b></div><div className="subtitle" style={enter(5)}>{text.subtitleZh}</div>
      <div className="tagline" style={enter(10)}>{text.taglineZh}</div><div className="tagline-en" style={enter(14)}>{text.taglineEn}</div>
      <div className="url" style={enter(20)}>{text.url}</div><div className="credits" style={enter(24)}>{text.credits}</div>
    </div>
    <AbsoluteFill style={{background:'black',opacity:clamp((local-(shotFrames(shot)-frames(shot.transitionOut?.seconds??0)))/Math.max(1,frames(shot.transitionOut?.seconds??0)))}}/>
  </AbsoluteFill>;
}

export const Promo:React.FC<Props>=(props)=>{
  const [fontHandle]=useState(()=>delayRender('Loading licensed fonts'));
  useEffect(()=>{let active=true;Promise.all([document.fonts.load('300 46px "Noto Sans SC"'),document.fonts.load('500 16px Inter')]).then(()=>{if(active)continueRender(fontHandle);});return()=>{active=false;};},[fontHandle]);
  const frame=useCurrentFrame();
  const shots=activeShots(props);
  const index=shots.findIndex(s=>frame>=frames(s.start)&&frame<frames(s.end));
  const shot=shots[Math.max(0,index)],previous=shots[Math.max(0,index-1)];
  const local=frame-frames(shot.start);
  const trans=frames(shot.transitionIn?.seconds??0);
  const fade=trans?clamp(local/trans):1;
  return <AbsoluteFill style={{background:'black'}}>
    <style>{`@font-face{font-family:'Noto Sans SC';src:url('${staticFile('fonts/NotoSansSC-variable.ttf')}') format('truetype');font-weight:100 900;}@font-face{font-family:Inter;src:url('${staticFile('fonts/Inter-variable.ttf')}') format('truetype');font-weight:100 900;}`}</style>
    {shot.type==='remotion-only'?<EndCard shot={shot} local={local} previous={previous} props={props}/>:<>
      {index>0&&fade<1&&<><Footage shot={previous} local={shotFrames(previous)-1} last props={props}/><Captions shot={previous} local={shotFrames(previous)-1}/></>}
      <AbsoluteFill style={{opacity:fade}}><Footage shot={shot} local={local} props={props}/><Captions shot={shot} local={local}/></AbsoluteFill>
    </>}
    {props.audioSrc&&<Audio src={image(props.audioSrc)}/>}
    {props.mode==='preview'&&<div className="preview">分镜静帧预览 · 非完整录制 / STORYBOARD STILL PREVIEW · NOT FINAL FOOTAGE</div>}
  </AbsoluteFill>;
};

export const Root:React.FC=()=> <>
  <Composition id="TerraScopePreview" component={Promo} durationInFrames={frames(spec.output.duration)} fps={fps} width={spec.output.width} height={spec.output.height} defaultProps={{mode:'preview',auroraShot:'s4-aurora'} satisfies Props}/>
  <Composition id="TerraScopeFinal" component={Promo} durationInFrames={frames(spec.output.duration)} fps={fps} width={spec.output.width} height={spec.output.height} defaultProps={{mode:'final',auroraShot:'s4-aurora'} satisfies Props}/>
</>;
