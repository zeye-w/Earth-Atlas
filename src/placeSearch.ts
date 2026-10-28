import type { Locale } from "./i18n/core.ts";
import countries from './data/countries.json' with { type: 'json' };
import { WORLD_CITIES } from './worldCities.ts';
import { validCoordinates } from './sceneState.ts';
export interface SearchPlace { id: string; name: string; detail: string; latitude: number; longitude: number; height: number }
export function coordinateSearch(query: string): SearchPlace | null {
  const match = query.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*[,，\s]\s*([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const latitude = Number(match[1]), longitude = Number(match[2]);
  if (!validCoordinates(latitude,longitude)) throw new Error('纬度范围 −90～90，经度范围 −180～180');
  return { id:'coordinate',name:`${latitude}, ${longitude}`, detail:'经纬度（纬度在前）',latitude,longitude,height:800000 };
}
export function localSearch(query: string, locale: Locale = "zh"): SearchPlace[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const coordinate = coordinateSearch(query);
  if (coordinate) return [coordinate];
  const nations = countries.filter(c => [c.name,c.official,c.chinese,c.code].some(n => n?.toLowerCase().includes(q))).slice(0,6).map(c => ({id:'country:'+c.code,name:locale === "en" ? c.name : c.chinese || c.name,detail:c.name+' · 国家/地区代表位置',latitude:c.lat,longitude:c.lon,height:Math.max(1500000,Math.min(14000000,Math.sqrt(c.area)*2200))}));
  const cities = WORLD_CITIES.filter(c => [c.chinese,c.english].some(n => n.toLowerCase().includes(q))).slice(0,6).map(c => ({id:c.id,name:locale === "en" ? c.english : c.chinese,detail:c.english+' · 城市',latitude:c.latitude,longitude:c.longitude,height:800000}));
  return [...nations,...cities];
}
export async function searchPlaces(query: string, signal: AbortSignal, locale: Locale = "zh"): Promise<SearchPlace[]> {
  const local = localSearch(query, locale);
  if (local.some(p => p.id === 'coordinate' || p.id.startsWith('country:'))) return local;
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({name:query,count:'6',language:locale}).toString();
  let response: Response;
  try { response = await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])}); }
  catch (error) { if (!signal.aborted && local.length) return local; throw error; }
  if (!response.ok) { if (local.length) return local; throw new Error('地名服务暂不可用，请尝试经纬度'); }
  const data = await response.json();
  const remote: SearchPlace[] = (Array.isArray(data.results) ? data.results : []).filter((p: any) => typeof p.name === 'string' && validCoordinates(p.latitude,p.longitude)).map((p: any) => ({id:'geonames:'+p.id,name:p.name,detail:[p.admin1,p.country].filter(Boolean).join(' · '),latitude:p.latitude,longitude:p.longitude,height:800000}));
  return [...local,...remote.filter(p => !local.some(l => Math.abs(l.latitude-p.latitude)<0.05 && Math.abs(l.longitude-p.longitude)<0.05))].slice(0,8);
}
