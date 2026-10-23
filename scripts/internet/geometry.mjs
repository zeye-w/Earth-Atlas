export const round = n => Math.round(n * 1000) / 1000;
export const position = (lon, lat) => lon !== null && lat !== null && lon !== '' && lat !== '' && Number.isFinite(+lon) && Number.isFinite(+lat) && Math.abs(+lon) <= 180 && Math.abs(+lat) <= 90 ? [round(+lon), round(+lat)] : null;

// Douglas–Peucker with distance to the finite segment, in geographic degrees.
export function simplify(points, tolerance = 0.04) {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]), stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(), p = points[a], q = points[b];
    const dx = q[0] - p[0], dy = q[1] - p[1], length = dx * dx + dy * dy;
    let best = tolerance * tolerance, index = -1;
    for (let i = a + 1; i < b; i++) {
      const r = points[i], t = length ? Math.max(0, Math.min(1, ((r[0] - p[0]) * dx + (r[1] - p[1]) * dy) / length)) : 0;
      const distance = (r[0] - p[0] - t * dx) ** 2 + (r[1] - p[1] - t * dy) ** 2;
      if (distance > best) { best = distance; index = i; }
    }
    // Simplification must not turn several safe segments into a globe-spanning line.
    if (index === -1 && Math.abs(dx) > 180 && b - a > 1) index = Math.floor((a + b) / 2);
    if (index !== -1) { keep.add(index); stack.push([a, index], [index, b]); }
  }
  return [...keep].sort((a, b) => a - b).map(i => points[i]);
}

export function splitAntimeridian(points) {
  const paths = []; let path = [];
  const finish = () => { if (path.length >= 2) paths.push(path); };
  for (const point of points) {
    const p = position(...point);
    if (!p) throw new Error('Invalid cable coordinate');
    const previous = path.at(-1);
    if (previous && Math.abs(p[0] - previous[0]) > 180) {
      const adjusted = p[0] + (p[0] > previous[0] ? -360 : 360);
      const edge = previous[0] >= 0 ? 180 : -180;
      const latitude = round(previous[1] + (p[1] - previous[1]) * (edge - previous[0]) / (adjusted - previous[0]));
      path.push([edge, latitude]); finish(); path = [[-edge, latitude]];
    }
    if (!path.length || p.some((v, i) => v !== path.at(-1)[i])) path.push(p);
  }
  finish();
  return paths.map(p => simplify(p));
}

// Spherical centroid avoids the 179E/179W arithmetic-mean trap.
export function centroid(points) {
  const sums = points.reduce((s, [lon, lat]) => {
    lon *= Math.PI / 180; lat *= Math.PI / 180;
    return [s[0] + Math.cos(lat) * Math.cos(lon), s[1] + Math.cos(lat) * Math.sin(lon), s[2] + Math.sin(lat)];
  }, [0, 0, 0]);
  return [round(Math.atan2(sums[1], sums[0]) * 180 / Math.PI), round(Math.atan2(sums[2], Math.hypot(sums[0], sums[1])) * 180 / Math.PI)];
}
