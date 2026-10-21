// Read the movie edit list rather than treating raw media start_time as movie
// time. QuickTime maps an empty edit (-1) to the selected key-photo timestamp.
function atoms(buffer, start = 0, end = buffer.length) {
  const result = [];
  for (let p = start; p < end;) {
    if (p + 8 > end) throw Error('Truncated MOV atom');
    const size = buffer.readUInt32BE(p), type = buffer.toString('latin1', p + 4, p + 8);
    if (size < 8 || p + size > end) throw Error('Invalid MOV atom size');
    result.push({type, start: p, end: p + size, body: p + 8}); p += size;
  }
  return result;
}
const child = (buffer, parent, name) => {
  const found = atoms(buffer, parent.body, parent.end).find(a => a.type === name);
  if (!found) throw Error('Missing MOV ' + name); return found;
};
export function inspectKeyPhoto(buffer) {
  const top = atoms(buffer), moov = top.find(a => a.type === 'moov'), mdat = top.find(a => a.type === 'mdat');
  if (!moov || !mdat) throw Error('Missing MOV media');
  const mvhd = child(buffer, moov, 'mvhd');
  if (buffer[mvhd.body] !== 0) throw Error('Unsupported movie header');
  const scale = buffer.readUInt32BE(mvhd.body + 12);
  for (const track of atoms(buffer, moov.body, moov.end).filter(a => a.type === 'trak')) {
    const mdia = child(buffer, track, 'mdia'), minf = child(buffer, mdia, 'minf'), stbl = child(buffer, minf, 'stbl'), stsd = child(buffer, stbl, 'stsd');
    if (!atoms(buffer, stsd.body + 8, stsd.end).some(a => a.type === 'mebx')) continue;
    const elst = child(buffer, child(buffer, track, 'edts'), 'elst');
    if (buffer[elst.body] !== 0 || buffer.readUInt32BE(elst.body + 4) !== 2) throw Error('Invalid key photo edit list');
    const delay = buffer.readUInt32BE(elst.body + 8);
    if (buffer.readInt32BE(elst.body + 12) !== -1 || buffer.readUInt32BE(elst.body + 20) !== 1 || buffer.readInt32BE(elst.body + 24) !== 0) throw Error('Invalid key photo edits');
    const stco = child(buffer, stbl, 'stco'), stsz = child(buffer, stbl, 'stsz');
    const offset = buffer.readUInt32BE(stco.body + 8), size = buffer.readUInt32BE(stsz.body + 4);
    if (buffer.readUInt32BE(stco.body + 4) !== 1 || buffer.readUInt32BE(stsz.body + 8) !== 1 || size !== 105 || offset < mdat.body || offset + size > mdat.end) throw Error('Invalid metadata sample');
    if (buffer.readUInt32BE(offset) !== 9 || buffer.readUInt32BE(offset + 4) !== 1 || buffer.readInt8(offset + 8) !== -1) throw Error('Missing still-image-time marker');
    return {time: delay / scale, width: buffer.readFloatBE(offset + 97), height: buffer.readFloatBE(offset + 101)};
  }
  throw Error('Missing key photo track');
}
