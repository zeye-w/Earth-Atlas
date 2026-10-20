import {readFileSync,writeFileSync,mkdirSync,cpSync,existsSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const args=Object.fromEntries(process.argv.slice(2).map((a,i,all)=>a.startsWith('--')?[a.slice(2),all[i+1]]:null).filter(Boolean));
const mode=args.mode??'preview';
if(!['preview','final'].includes(mode))throw Error('mode must be preview or final');
const spec=JSON.parse(readFileSync(resolve(root,'video/shots.json'),'utf8'));
const pub=resolve(root,'video/remotion/public');
mkdirSync(pub,{recursive:true});
cpSync(resolve(root,'video/preview'),resolve(pub,'preview'),{recursive:true});
if(existsSync(resolve(root,'video/audio/fonts')))cpSync(resolve(root,'video/audio/fonts'),resolve(pub,'fonts'),{recursive:true});
if(existsSync(resolve(root,'video/audio/terrascope-original.wav')))cpSync(resolve(root,'video/audio/terrascope-original.wav'),resolve(pub,'score.wav'));
let auroraShot=args.aurora??'s4b-atmosphere';
const props={mode,auroraShot,manifest:{shots:{}}};
const integrity=[];
if(mode==='final'){
  const source=resolve(root,args.captures??'video/production/public/captures');
  const manifest=JSON.parse(readFileSync(resolve(source,'manifest.json'),'utf8'));
  const specHash=createHash('sha256').update(readFileSync(resolve(root,'video/shots.json'))).digest('hex');
  if(manifest.specSha256!==specHash)throw Error('Capture specification differs from current shots.json');
  const aurora=manifest.shots.find(s=>(s.requestedId==='s4-aurora'||s.id==='s4-aurora'||s.id==='s4b-atmosphere')&&s.status==='complete');
  if(!aurora)throw Error('Aurora or approved fallback capture is missing');
  props.auroraShot=aurora.id;
  for(const shot of spec.shots.filter(s=>s.type!=='remotion-only'&&(s.id.startsWith('s4')?s.id===props.auroraShot:!s.optional))){
    const captured=manifest.shots.find(s=>s.id===shot.id&&s.status==='complete');
    const count=shot.time.mode==='hourly-stills'?Math.abs(shot.time.toHours-shot.time.fromHours)+1:Math.round((shot.end-shot.start)*spec.output.fps);
    if(!captured||captured.frames.length!==count)throw Error('Incomplete capture: '+shot.id);
    const files=[];
    for(const [index,frame] of [...captured.frames].sort((a,b)=>a.index-b.index).entries()){
      if(frame.index!==index)throw Error('Missing or duplicate frame index: '+shot.id);
      const path=resolve(source,frame.path);
      if(!relative(source,path)||relative(source,path).startsWith('..')||!existsSync(path))throw Error('Unsafe/missing frame '+frame.path);
      const png=readFileSync(path);
      if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.readUInt32BE(16)!==spec.output.width||png.readUInt32BE(20)!==spec.output.height)throw Error('Invalid capture dimensions: '+frame.path);
      integrity.push({path:frame.path,bytes:png.length,sha256:createHash('sha256').update(png).digest('hex')});
      const output=resolve(pub,'frames',shot.id,String(frame.index).padStart(4,'0')+'.png');
      mkdirSync(dirname(output),{recursive:true});cpSync(path,output);
      files.push('frames/'+shot.id+'/'+String(frame.index).padStart(4,'0')+'.png');
    }
    props.manifest.shots[shot.id]={files};
  }
  mkdirSync(resolve(root,'video/delivery'),{recursive:true});
  cpSync(resolve(source,'manifest.json'),resolve(root,'video/delivery/capture-manifest.json'));
  writeFileSync(resolve(root,'video/delivery/capture-integrity.json'),JSON.stringify({specSha256:specHash,frames:integrity},null,2));
  cpSync(resolve(root,'video/CREDITS.md'),resolve(root,'video/delivery/CREDITS.md'));
  const records=resolve(root,'video/delivery/source-records');mkdirSync(records,{recursive:true});
  for(const name of ['noaa-ovation.json','s7-clouds-cloud-catalog.json'])if(existsSync(resolve(source,name)))cpSync(resolve(source,name),resolve(records,name));
  const licenses=resolve(root,'video/delivery/licenses');mkdirSync(licenses,{recursive:true});
  for(const name of ['Inter-OFL.txt','NotoSansSC-OFL.txt','SOURCES.md'])cpSync(resolve(root,'video/audio/fonts',name),resolve(licenses,name));
}
const delivery=resolve(root,'video/delivery');mkdirSync(delivery,{recursive:true});
writeFileSync(resolve(delivery,mode+'-props.json'),JSON.stringify(props,null,2));
const time=t=>{const ms=Math.round(t*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
const captions=spec.shots.filter(s=>(s.id==='s4-aurora'||s.id==='s4b-atmosphere')?s.id===props.auroraShot:!s.optional).flatMap(s=>(s.captions??[]).map(c=>({from:s.start+c.in,to:s.start+c.out,text:c.zh+'\n'+c.en})));
const ending=spec.shots.find(s=>s.type==='remotion-only');
if(ending)captions.push({from:ending.start,to:ending.end,text:ending.text.taglineZh+'\n'+ending.text.taglineEn});
const srt=captions.map((c,i)=>`${i+1}\n${time(c.from)} --> ${time(c.to)}\n${c.text}\n`).join('\n');
writeFileSync(resolve(delivery,mode==='final'?'terrascope-promo-30s.srt':'terrascope-storyboard-preview.srt'),srt);
console.log('Staged '+mode+'; aurora slot: '+props.auroraShot);
