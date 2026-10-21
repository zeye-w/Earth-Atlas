import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import ffmpeg from 'ffmpeg-static';
import ffprobe from '@ffprobe-installer/ffprobe';
import {zipSync, strToU8} from 'fflate';
import {pairJpeg} from './jpeg.mjs';
import {inspectKeyPhoto} from './movValidation.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export function run(command, args, timeout = 120_000) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {windowsHide: true, shell: false});
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {child.kill(); reject(Error('转换超时，请缩小录制尺寸后重试'));}, timeout);
    child.stdout.on('data', b => {if (stdout.length < 2_000_000) stdout += b;});
    child.stderr.on('data', b => {if (stderr.length < 2_000_000) stderr += b;});
    child.on('error', error => {clearTimeout(timer); reject(error);});
    child.on('close', code => {clearTimeout(timer); code === 0 ? resolveRun(stdout) : reject(Error(stderr.slice(-3000) || '转换失败'));});
  });
}
export async function exportPair(input, directory, cover, scene = {}) {
  const inputLimits = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm'];
  const info = JSON.parse(await run(ffprobe.path, ['-v', 'error', ...inputLimits, '-show_streams', '-show_format', '-of', 'json', input]));
  const video = info.streams.find(s => s.codec_type === 'video');
  // WebM from MediaRecorder can lack container duration. Decoding to a bounded
  // MOV first yields authoritative duration/frame counts before any packaging.
  if (!video || video.width > 1920 || video.height > 1920 || video.width < 2 || video.height < 2) throw Error('录制画面尺寸无效（最长边不超过 1920）');
  const base = resolve(directory, 'base.mov');
  const id = randomUUID().toUpperCase();
  await run(ffmpeg, ['-y', '-v', 'error', ...inputLimits, '-i', input, '-t', '3', '-map', '0:v:0', '-an', '-map_metadata', '-1', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1', '-r', '30', '-c:v', 'libx264', '-profile:v', 'high', '-crf', '18', '-pix_fmt', 'yuv420p', '-movie_timescale', '600', '-movflags', 'use_metadata_tags', '-metadata', 'com.apple.quicktime.content.identifier=' + id, base]);
  const normalized = JSON.parse(await run(ffprobe.path, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', base]));
  const duration = Number(normalized.format.duration);
  if (!Number.isFinite(duration) || duration < 2 || duration > 3.1 || !Number.isFinite(cover) || cover < 0 || cover >= duration - 1 / 30) throw Error('封面须位于 2–3 秒录制片段内，请重新选择');
  const stillTime = Math.round(cover * 30) / 30;
  const rawCover = resolve(directory, 'cover.jpg');
  await run(ffmpeg, ['-y', '-v', 'error', '-i', base, '-ss', String(stillTime), '-frames:v', '1', '-q:v', '2', rawCover]);
  const image = pairJpeg(await readFile(rawCover), id);
  const movPath = resolve(directory, 'TERRASCOPE.MOV');
  await run(process.env.PYTHON_PATH || 'python', [resolve(here, 'vendor/makelive_mov.py'), base, movPath, '--still-time', String(stillTime), '--template', resolve(here, 'vendor/apple-meta-trak.bin')]);
  const mov = await readFile(movPath);
  const keyPhoto = inspectKeyPhoto(mov), normalizedVideo = normalized.streams.find(s => s.codec_type === 'video');
  if (Math.abs(keyPhoto.time - stillTime) > 1 / 600 || keyPhoto.width !== normalizedVideo.width || keyPhoto.height !== normalizedVideo.height) throw Error('封面时间或尺寸配对检查失败');
  const pairedInfo = JSON.parse(await run(ffprobe.path, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', movPath]));
  if (pairedInfo.format.tags?.['com.apple.quicktime.content.identifier'] !== id || !pairedInfo.streams.some(s => s.codec_tag_string === 'mebx')) throw Error('Live Photo 配对元数据检查失败');
  await run(ffmpeg, ['-v', 'error', '-i', movPath, '-map', '0:v:0', '-f', 'null', '-']);
  const manifest = {version: 1, identifier: id, coverTime: stillTime, duration, createdAt: new Date().toISOString(), source: 'TerraScope 当前场景浏览器录制', scene, validation: {pairedIdentifier: true, timedMetadataTrack: true, videoDecoded: true, iPhonePhotosTested: false}, audio: false};
  const guide = `TerraScope iPhone 实况图资源包\n\nTERRASCOPE.JPG + TERRASCOPE.MOV 是同一实况图的配对资源，请勿拆分、改写元数据或经聊天软件压缩转发。\n\n导入建议：在 Mac 的“照片”中同时导入这两个文件，再通过 iCloud 照片同步到 iPhone；或由支持 pairedVideo + photo 的 iOS 导入工具保存。单独从 Safari 下载 JPG/MOV 不会自动合并为实况照片。\n\n本版本已检查配对标识、封面时间轨及视频解码，尚未通过 iPhone 真机相册识别测试。请先导入，确认显示 LIVE、可播放且封面正确后再发布。\n\n画面来自网站当前渲染，不是相机实拍。源数据、水印和署名保留，未增强或编造科学数据。无麦克风录音。\n\n封面时间：${stillTime.toFixed(3)} 秒；长度：${duration.toFixed(3)} 秒。\n`;
  const files = {'TERRASCOPE.JPG': image, 'TERRASCOPE.MOV': mov, 'scene.json': strToU8(JSON.stringify(manifest, null, 2)), '导入说明.txt': strToU8(guide)};
  const zip = zipSync(files, {level: 0});
  await writeFile(resolve(directory, 'result.zip'), zip);
  return {zip, manifest, image, mov};
}
