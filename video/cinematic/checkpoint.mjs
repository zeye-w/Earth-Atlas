import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export function treeHash(root) {
  const items = [];
  const visit = dir => { for (const entry of readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    const file=join(dir,entry.name);
    if(entry.isDirectory()) visit(file);
    else items.push([relative(root,file).replaceAll("\\","/"),sha256(readFileSync(file))]);
  }};
  visit(root); return sha256(JSON.stringify(items));
}
export function atomicJson(file, data) {
  writeFileSync(file+".tmp",JSON.stringify(data,null,1)); renameSync(file+".tmp",file);
}
export function reusableFrame(entry, out) {
  if(!entry?.settled || !entry.sha256 || !/^\d{4}\.jpg$/.test(entry.file)) return false;
  const file=join(out,entry.file);
  if(!existsSync(file)) return false;
  const bytes=readFileSync(file);
  return bytes.length>4 && bytes[0]===255 && bytes[1]===216 && bytes.at(-2)===255 && bytes.at(-1)===217 && sha256(bytes)===entry.sha256;
}
