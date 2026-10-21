// Apple MakerNote 0x0011 identifies the photo/video pair. No camera identity,
// location, or camera-capture claims are added to this rendered scene.
export function pairJpeg(jpeg, identifier) {
  if (!/^[0-9a-f-]{36}$/i.test(identifier) || jpeg.readUInt16BE(0) !== 0xffd8) throw Error('Invalid JPEG/identifier');
  const id = Buffer.from(identifier + '\0');
  const maker = Buffer.alloc(32 + id.length);
  Buffer.from('Apple iOS\0\0\x01MM', 'binary').copy(maker);
  maker.writeUInt16BE(1, 14);
  maker.writeUInt16BE(0x11, 16); maker.writeUInt16BE(2, 18);
  maker.writeUInt32BE(id.length, 20); maker.writeUInt32BE(32, 24);
  id.copy(maker, 32);
  // Big-endian TIFF: IFD0 -> ExifIFD -> MakerNote, offsets relative to TIFF.
  const tiff = Buffer.alloc(44 + maker.length);
  tiff.write('MM'); tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8); tiff.writeUInt16BE(0x8769, 10);
  tiff.writeUInt16BE(4, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt32BE(26, 18);
  tiff.writeUInt16BE(1, 26); tiff.writeUInt16BE(0x927c, 28);
  tiff.writeUInt16BE(7, 30); tiff.writeUInt32BE(maker.length, 32); tiff.writeUInt32BE(44, 36);
  maker.copy(tiff, 44);
  const body = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const header = Buffer.alloc(4); header.writeUInt16BE(0xffe1); header.writeUInt16BE(body.length + 2, 2);
  // FFmpeg's freshly generated cover has no inherited EXIF/MakerNotes.
  return Buffer.concat([jpeg.subarray(0, 2), header, body, jpeg.subarray(2)]);
}
