/** Verified model registry. Display spans are framing aids, not engineering dimensions. */
export interface SatelliteModelInfo { url: string; span: number; credit: string; source: string; schematic: boolean; }
const repository="https://github.com/nasa/NASA-3D-Resources/tree/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models/";
export const SATELLITE_MODELS: Readonly<Record<string,SatelliteModelInfo>> = {
  iss:{url:"/models/satellites/iss.glb",span:109,credit:"NASA · ISS (A)",source:repository+"International%20Space%20Station%20(ISS)%20(A)",schematic:false},
  hubble:{url:"/models/satellites/hubble.glb",span:13.2,credit:"NASA · Hubble (A)",source:repository+"Hubble%20Space%20Telescope%20(A)",schematic:false},
  terra:{url:"/models/satellites/terra.glb",span:10,credit:"NASA · Terra（材质简化）",source:repository+"Terra",schematic:false},
  tiangong:{url:"/models/satellites/tiangong.glb",span:55,credit:"Earth Atlas · 天宫 T 字构型示意",source:"https://github.com/zeye-w/Earth-Atlas/blob/main/video/cinematic/tiangong_model.py",schematic:true},
};
export type SatelliteModelStatus="far"|"loading"|"ready"|"error"|"unavailable";
export const MODEL_LOAD_DISTANCE=50_000;
export const MODEL_RELEASE_DISTANCE=75_000;
export function modelInRange(distance: number, loaded: boolean): boolean {
  return Number.isFinite(distance) && distance>=0 && distance<=(loaded?MODEL_RELEASE_DISTANCE:MODEL_LOAD_DISTANCE);
}
