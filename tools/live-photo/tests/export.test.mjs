import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from '@ffprobe-installer/ffprobe';
import {ExifTool} from 'exiftool-vendored';
import {unzipSync, strFromU8} from 'fflate';
import {exportPair, run} from '../export.mjs';
import {inspectKeyPhoto} from '../movValidation.mjs';

test('generated pair has independently readable Apple identifiers, timed key photo, intact frames and cover', {timeout: 60_000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'terrascope-test-'));
  const exiftool = new ExifTool();
  try {
    const input = join(directory, 'synthetic.webm');
    await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-t', '3', '-c:v', 'libvpx-vp9', '-an', input]);
    const result = await exportPair(input, directory, 1.2, {testFixture: true});
    const files = unzipSync(result.zip);
    assert.deepEqual(Object.keys(files).sort(), ['TERRASCOPE.JPG','TERRASCOPE.MOV','scene.json','导入说明.txt'].sort());
    const photoPath = join(directory, 'TERRASCOPE.JPG'); await writeFile(photoPath, files['TERRASCOPE.JPG']);
    const photo = await exiftool.read(photoPath);
    const movie = await exiftool.read(join(directory, 'TERRASCOPE.MOV'), {readArgs: ['-ee']});
    assert.equal(photo.ContentIdentifier, result.manifest.identifier);
    assert.equal(movie.ContentIdentifier, photo.ContentIdentifier);
    assert.equal(photo.Make, undefined); assert.equal(photo.Model, undefined);
    assert.ok(movie.StillImageTime !== undefined, 'ExifTool must recognize the Apple timed metadata');
    assert.ok(!photo.errors?.length, JSON.stringify(photo.errors));
    const info = JSON.parse(await run(ffprobe.path, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(directory, 'TERRASCOPE.MOV')]));
    const track = info.streams.find(s => s.codec_tag_string === 'mebx');
    assert.ok(track);
    // ffprobe/ExifTool expose raw media time (zero); the movie edit list maps
    // that one metadata sample to the chosen movie timestamp (Apple QTFF).
    assert.deepEqual(inspectKeyPhoto(result.mov), {time: 1.2, width: 320, height: 240});
    const video = info.streams.find(s => s.codec_type === 'video');
    assert.equal(Number(video.nb_frames), 90); assert.equal(video.width, 320); assert.equal(video.height, 240);
    assert.equal(JSON.parse(strFromU8(files['scene.json'])).validation.iPhonePhotosTested, false);
    // The JPEG pixels must be exactly the frame independently decoded at the
    // metadata timestamp; adding EXIF must not touch the compressed image.
    await run(ffmpeg, ['-y', '-v', 'error', '-i', join(directory, 'TERRASCOPE.MOV'), '-ss', '1.2', '-frames:v', '1', '-q:v', '2', join(directory, 'independent.jpg')]);
    const raw = await readFile(join(directory, 'independent.jpg'));
    const sos = buffer => buffer.subarray(buffer.indexOf(Buffer.from([0xff, 0xda])));
    assert.deepEqual(sos(Buffer.from(files['TERRASCOPE.JPG'])), sos(raw));
    await assert.rejects(exportPair(input, directory, 3.5), /封面/);
  } finally {await exiftool.end(); await rm(directory, {recursive: true, force: true});}
});
