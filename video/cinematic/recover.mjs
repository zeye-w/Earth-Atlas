/** Assemble original frames plus strictly settled repairs without touching source artifacts.
 * node recover.mjs SOURCE_ARTIFACT_DIR REPAIR_DIR PLAN_DIR OUTPUT_DIR SOURCE_RUN_ID
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAMES } from './story.mjs';

const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function reportsIn(dir) {
  return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?reportsIn(join(dir,entry.name)):entry.name.startsWith('capture-')&&entry.name.endsWith('.json')?[join(dir,entry.name)]:[]);
}

export function validateRecoveredFrames(original, repairs, count=FRAMES) {
  const frames=new Map();
  for(const entry of original) {
    if(!Number.isInteger(entry.frame)||entry.frame<0||entry.frame>=count||frames.has(entry.frame)||entry.t!==entry.frame/30)throw Error('Invalid or duplicate original frame');
    frames.set(entry.frame,entry);
  }
  if(frames.size!==count)throw Error('Original frame set incomplete');
  const replaced=new Set();
  for(const entry of repairs) {
    const old=frames.get(entry.frame);
    if(!old||old.settled||replaced.has(entry.frame)||entry.settled!==true||entry.t!==old.t||JSON.stringify(entry.camera)!==JSON.stringify(old.camera))throw Error('Repair changes an existing good frame, camera or time, or is not settled');
    frames.set(entry.frame,entry);replaced.add(entry.frame);
  }
  if([...frames.values()].some(entry=>entry.settled!==true))throw Error('Unsettled frames remain: repair all of them');
  return [...frames.values()].sort((a,b)=>a.frame-b.frame);
}

export function recover(source, repairs, planDir, output, sourceRun) {
  if(resolve(output)===resolve(source)||resolve(output)===resolve(repairs))throw Error('Output must be a new directory');
  if(existsSync(output))throw Error('Recovery output already exists');
  const planPath=join(planDir,'plan.json'),plan=JSON.parse(readFileSync(planPath,'utf8'));
  if(plan.mode!=='full'||plan.station?.noradId!==48274||plan.region?.id!=='middle-east')throw Error('Not the approved station/region/full snapshot');
  const paths=new Map(),original=[],replacement=[],reportHashes=[],sourceWarnings=[];
  for(const [dir,target,isRepair] of [[source,original,false],[repairs,replacement,true]])for(const path of reportsIn(dir)){
    const report=JSON.parse(readFileSync(path,'utf8'));
    if(report.plan?.T0!==plan.T0||report.missing?.length||report.errors?.some(error=>isRepair||error.startsWith("JS ")))throw Error('Snapshot mismatch or capture errors: '+path);
    if(isRepair&&report.failure)throw Error('Repair capture failed');
    reportHashes.push({file:basename(path),sha256:sha(path),repair:isRepair});
    if (report.errors?.length) sourceWarnings.push({range:report.range,errors:report.errors});
    for(const entry of report.frames){
      const file=String(entry.frame).padStart(4,'0')+'.jpg';
      if(entry.file!==file)throw Error('Unexpected frame filename');
      const image=join(resolve(path,'..'),file);
      if(!existsSync(image))throw Error('Missing image '+image);
      paths.set(`${isRepair?'repair':'original'}:${entry.frame}`,image);target.push(entry);
    }
  }
  const merged=validateRecoveredFrames(original,replacement);
  mkdirSync(output,{recursive:true});
  const repaired=new Set(replacement.map(e=>e.frame)),lineage=[];
  for(const entry of merged){
    const before=paths.get(`original:${entry.frame}`),after=paths.get(`${repaired.has(entry.frame)?'repair':'original'}:${entry.frame}`);
    const bytes=readFileSync(after);if(bytes[0]!==255||bytes[1]!==216)throw Error('Invalid JPEG '+after);
    copyFileSync(after,join(output,entry.file));
    lineage.push({frame:entry.frame,repaired:repaired.has(entry.frame),originalSha256:sha(before),sha256:sha(after)});
  }
  const snapshotIndex=JSON.parse(readFileSync(join(planDir,'data/index.json'),'utf8'));
  const snapshotFiles=[...new Set(snapshotIndex.map(e=>e.file))].map(file=>{
    if(basename(file)!==file)throw Error('Invalid snapshot filename');
    return {file,sha256:sha(join(planDir,'data',file))};
  });
  const provenance={sourceRun:String(sourceRun),T0:plan.T0,planSha256:sha(planPath),snapshotFiles,sourceWarnings,repairedFrames:[...repaired].sort((a,b)=>a-b),reports:reportHashes,frames:lineage};
  writeFileSync(join(output,'recovery.json'),JSON.stringify(provenance,null,2));
  writeFileSync(join(output,'capture-recovered.json'),JSON.stringify({plan:{T0:plan.T0,mode:'full'},range:'recovered',frames:merged,errors:sourceWarnings.flatMap(item=>item.errors),missing:[],unsettled:0,sourceRun:String(sourceRun)},null,1));
  console.log(JSON.stringify({frames:merged.length,repairedFrames:provenance.repairedFrames,unsettled:0,output}));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==7)throw Error('Expected SOURCE REPAIRS PLAN OUTPUT SOURCE_RUN');
  recover(...process.argv.slice(2));
}
