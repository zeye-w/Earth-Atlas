/** Record real research input outside the repository. No root-response redistribution. */
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {anchorPageUrl,ANCHOR_PAGE_LIMIT,selectProbes} from './probes.ts';
import {DNS_MEASUREMENTS} from '../../src/internet/dnsFlows.ts';
const directory=await mkdtemp(join(tmpdir(),'earth-dns-coverage-'));
const userAgent='Earth-Atlas (+https://github.com/zeye-w/Earth-Atlas)';
const useCurl=process.argv.includes('--curl');
async function read(url){
 if(useCurl){const text=execFileSync(process.platform==='win32'?'curl.exe':'curl',['--fail','--silent','--show-error','--max-time','25','-A',userAgent,url],{encoding:'utf8',maxBuffer:5000000});return JSON.parse(text);}
 const response=await fetch(url,{headers:{'User-Agent':userAgent,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw Error('Upstream '+response.status);return response.json();
}
const roots={};for(const l of 'abcdefghijklm'){
 if(Object.keys(roots).length)await new Promise(resolve=>setTimeout(resolve,1000));
 roots[l]=await read(`https://root-servers.org/root/${l.toUpperCase()}/json/`);
}
const rootPath=join(directory,'roots-private.json');await writeFile(rootPath,JSON.stringify(roots));
const probes=[];
for(let page=1;page<=ANCHOR_PAGE_LIMIT;page++){
 const data=await read(anchorPageUrl(page));probes.push(...data.results);
 if(!data.next)break;if(page===ANCHOR_PAGE_LIMIT)throw Error('Anchor page budget exceeded');
}
const sample=selectProbes(probes,200),all={};
for(const[l,id]of Object.entries(DNS_MEASUREMENTS))all[l]=await read(`https://atlas.ripe.net/api/v2/measurements/${id}/latest/?probe_ids=${sample.map(p=>p.id).join(',')}`);
const path=join(directory,'atlas-recording.json');await writeFile(path,JSON.stringify({probes,all}));
console.log(JSON.stringify({rootPath,recording:path,warning:'Private root recording: do not commit or publish.'}));
