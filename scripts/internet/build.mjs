import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCables, buildPeering, buildRoots } from './sources.mjs';
import { validateBundle } from './validate.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export function publicationAllowed(env = process.env) {
  return env.INTERNET_DATA_PUBLICATION_APPROVED === 'true' && Boolean(env.INTERNET_DATA_PERMISSION_REFERENCE?.trim());
}

export async function build() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output-dir')) throw new Error('Usage: build.mjs [--output-dir .cache/internet-preview]');
  const output = resolve(root, args[1] || 'public/data/internet');
  const preview = output.startsWith(resolve(root, '.cache') + (process.platform === 'win32' ? '\\' : '/'));
  if (!preview && !publicationAllowed()) throw new Error('Publication withheld: obtain/record TeleGeography data reuse, PeeringDB bulk redistribution and root-servers.org reuse permission. Set INTERNET_DATA_PUBLICATION_APPROVED=true and INTERNET_DATA_PERMISSION_REFERENCE to the documented approvals. For local research use --output-dir .cache/internet-preview.');
  const bundle = {}, quality = {};
  // Deliberately serial: one source failure prevents publication of every file.
  for (const builder of [buildRoots, buildPeering, buildCables]) {
    const result = await builder(); Object.assign(bundle, result.datasets); Object.assign(quality, result.quality);
  }
  validateBundle(bundle);
  const report = {};
  for (const [name, dataset] of Object.entries(bundle)) {
    const content = rows => JSON.stringify(Object.fromEntries(Object.entries(rows).filter(([key]) => key !== 'generatedAt' && key !== 'sources')));
    try {
      const old = JSON.parse(await readFile(resolve(output, name), 'utf8'));
      // Preserve provenance/time when upstream content did not change.
      if (content(old) === content(dataset)) bundle[name] = old;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    report[name] = { bytes: Buffer.byteLength(JSON.stringify(bundle[name]) + '\n'), counts: Object.fromEntries(Object.entries(dataset).filter(([, v]) => Array.isArray(v)).filter(([k]) => k !== 'sources').map(([k, v]) => [k, v.length])) };
  }
  const staging = `${output}.staging-${process.pid}`, backup = `${output}.backup-${process.pid}`;
  await mkdir(dirname(output), { recursive: true });
  await mkdir(staging);
  let backedUp = false;
  try {
    for (const [name, dataset] of Object.entries(bundle)) await writeFile(resolve(staging, name), JSON.stringify(dataset) + '\n');
    try { await rename(output, backup); backedUp = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(staging, output); } catch (error) { if (backedUp) await rename(backup, output); throw error; }
    if (backedUp) await rm(backup, { recursive: true });
  } finally { await rm(staging, { recursive: true, force: true }); }
  console.log(JSON.stringify({ files: report, quality }, null, 2));
  await mkdir(resolve(root, '.cache'), { recursive: true });
  await writeFile(resolve(root, '.cache/internet-quality.json'), JSON.stringify({ files: report, quality }, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build().catch(error => { console.error(error.message); process.exitCode = 1; });
