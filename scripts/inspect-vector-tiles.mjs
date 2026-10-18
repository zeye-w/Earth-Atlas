/**
 * Inspect public Macrostrat MVT tiles and report attributes for styling.
 * Small read-only protobuf decoder; no credentials or external dependencies.
 * Run: node scripts/inspect-vector-tiles.mjs
 */
function parseFields(bytes) {
  let offset = 0;
  const fields = [];
  const readVarint = () => {
    let value = 0, shift = 0, count = 0;
    while (offset < bytes.length && count++ < 10) {
      const b = bytes[offset++];
      value += (b & 127) * (2 ** shift);
      if (!(b & 128)) return value;
      shift += 7;
    }
    throw Error("Invalid protobuf varint");
  };
  while (offset < bytes.length) {
    const key = readVarint(), field = key >>> 3, wire = key & 7;
    if (wire === 0) fields.push({ field, wire, value: readVarint() });
    else if (wire === 2) {
      const size = readVarint();
      if (offset + size > bytes.length) throw Error("Truncated protobuf data");
      fields.push({ field, wire, value: bytes.subarray(offset, offset + size) });
      offset += size;
    } else if (wire === 5 || wire === 1) {
      const len = wire === 5 ? 4 : 8;
      fields.push({ field, wire, value: bytes.subarray(offset, offset + len) });
      offset += len;
    } else throw Error("Unexpected protobuf wire type " + wire);
  }
  return fields;
}
const str = (buffer) => new TextDecoder().decode(buffer);
function unpack(buffer) {
  let offset = 0; const ints = [];
  while (offset < buffer.length) {
    let value = 0, shift = 0;
    while (offset < buffer.length) {
      const b = buffer[offset++];
      value += (b & 127) * 2 ** shift;
      if (!(b & 128)) break;
      shift += 7;
    }
    ints.push(value);
  }
  return ints;
}
function propertyValue(buffer) {
  const first = parseFields(buffer)[0];
  if (!first) return null;
  if (first.field === 1) return str(first.value);
  if (first.field === 2) return new DataView(first.value.buffer, first.value.byteOffset, 4).getFloat32(0, true);
  if (first.field === 3) return new DataView(first.value.buffer, first.value.byteOffset, 8).getFloat64(0, true);
  if (first.field === 7) return Boolean(first.value);
  return first.value;
}
function inspect(buf) {
  const out = [];
  for (const field of parseFields(buf).filter((f) => f.field === 3 && f.wire === 2)) {
    const layer = parseFields(field.value);
    const name = str(layer.find((f) => f.field === 1)?.value ?? new Uint8Array());
    const keys = layer.filter((f) => f.field === 3).map((f) => str(f.value));
    const values = layer.filter((f) => f.field === 4).map((f) => propertyValue(f.value));
    const features = layer.filter((f) => f.field === 2);
    const sample = features.slice(0, 3).map((f) => {
      const flds = parseFields(f.value);
      const tagField = flds.find((x) => x.field === 2);
      const tags = tagField ? unpack(tagField.value) : [];
      return Object.fromEntries(Array.from({length: Math.floor(tags.length / 2)}, (_, i) => [keys[tags[2 * i]], values[tags[2 * i + 1]]]));
    });
    out.push({ name, keys, features: features.length, sample });
  }
  return out;
}
let success = false;
for (const [z, x, y] of [[0,0,0], [2,1,1], [3,2,3], [4,3,6]]) {
  const url = "https://tiles.macrostrat.org/carto/" + z + "/" + x + "/" + y;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "Origin": "https://earth-atlas.edwardlab.workers.dev" }});
    const type = res.headers.get("content-type"), cors = res.headers.get("access-control-allow-origin");
    if (!res.ok) throw Error("HTTP " + res.status);
    const buffer = new Uint8Array(await res.arrayBuffer());
    const summary = inspect(buffer);
    console.log(JSON.stringify({ tile: z + "/" + x + "/" + y, status:res.status,type,cors,bytes:buffer.length,layers:summary },null,2));
    if (summary.some((l) => l.name === "units" && l.features > 0)) success = true;
  } catch (error) {
    console.error("Tile",z,x,y,String(error));
  }
}
if (!success) process.exitCode = 1;
