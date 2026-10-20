export const LAYER_KEYS = ['clouds','geology','dayNight','cities','atmosphere','aurora','lights','quakes','plates','volcanoes','satellites','paths'] as const;
export type LayerKey = typeof LAYER_KEYS[number];
export interface SceneState {
  v: 1;
  camera: [number, number, number, number, number, number];
  // Layers added later are optional so earlier shared links stay valid.
  layers: Record<LayerKey, boolean> & { geoLabels?: boolean; trueColor?: boolean };
  /** Timeline moment (ms since epoch); absent = live. */
  time?: number;
  point?: { latitude: number; longitude: number };
  options: { cloudOpacity: number; opacity: number; mapMode: 'raster'|'age'|'lithology'; ageFilter: 'all'|'cenozoic'|'mesozoic'|'paleozoic'|'precambrian'; rockFilter: 'all'|'sedimentary'|'igneous'|'metamorphic'; quakeRange: 'day'|'week'|'month'; atmosphereShells?: 0|1|5|20 };
}
export function validCoordinates(lat: unknown, lon: unknown): boolean {
  return typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90 && typeof lon === 'number' && Number.isFinite(lon) && Math.abs(lon) <= 180;
}
export function readScene(hash: string): SceneState | null {
  try {
    if (hash.length > 6000) return null;
    const raw = new URLSearchParams(hash.replace(/^#/, '')).get('scene');
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s.v !== 1 || !Array.isArray(s.camera) || s.camera.length !== 6 || !s.camera.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) return null;
    if (!validCoordinates(s.camera[1], s.camera[0]) || s.camera[2] < 15000 || s.camera[2] > 65000000 || Math.abs(s.camera[3]) > 7 || Math.abs(s.camera[4]) > Math.PI / 2 || Math.abs(s.camera[5]) > 7) return null;
    if (!s.layers || !LAYER_KEYS.every(k => typeof s.layers[k] === 'boolean')) return null;
    if (['geoLabels','trueColor'].some(k => s.layers[k] !== undefined && typeof s.layers[k] !== 'boolean')) return null;
    if (s.time !== undefined && !(Number.isFinite(s.time) && s.time > 0)) return null;
    if (s.point && !validCoordinates(s.point.latitude,s.point.longitude)) return null;
    const o = s.options;
    if (!o || !Number.isFinite(o.cloudOpacity) || o.cloudOpacity < 10 || o.cloudOpacity > 100 || !Number.isFinite(o.opacity) || o.opacity < 15 || o.opacity > 100) return null;
    if (!['raster','age','lithology'].includes(o.mapMode) || !['all','cenozoic','mesozoic','paleozoic','precambrian'].includes(o.ageFilter) || !['all','sedimentary','igneous','metamorphic'].includes(o.rockFilter) || !['day','week','month'].includes(o.quakeRange)) return null;
    // Optional (added later) so earlier shared links stay valid; 0 = off.
    if (o.atmosphereShells !== undefined && ![0,1,5,20].includes(o.atmosphereShells)) return null;
    return s as SceneState;
  } catch { return null; }
}
export function sceneHash(scene: SceneState): string {
  const params = new URLSearchParams({scene:JSON.stringify(scene)});
  const hash = '#' + params.toString();
  if (!readScene(hash)) throw new Error('Invalid scene');
  return hash;
}
