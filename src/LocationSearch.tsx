import { useEffect, useRef, useState } from 'react';
import { searchPlaces, type SearchPlace } from './placeSearch';
export function PlaceSearch({ onSelect }: { onSelect: (place: SearchPlace) => void }) {
  const [query,setQuery] = useState('');
  const [results,setResults] = useState<SearchPlace[]>([]);
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(),[]);
  return <form className="place-search" role="search" onSubmit={async event => {
    event.preventDefault();
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    if (!query.trim()) { setMessage('请输入城市、国家或纬度, 经度'); return; }
    setBusy(true); setResults([]); setMessage('');
    try {
      const places = await searchPlaces(query.trim(),request.signal);
      if (!request.signal.aborted) { setResults(places); setMessage(places.length ? '' : '未找到地点，可尝试英文名称或经纬度'); }
    } catch (error) {
      if (!request.signal.aborted) setMessage(error instanceof Error ? error.message : '搜索失败');
    } finally { if (!request.signal.aborted) setBusy(false); }
  }}>
    <label htmlFor="place-query">搜索地点</label>
    <div className="search-input-row"><input id="place-query" type="search" maxLength={100} value={query} placeholder="城市 / 国家 / 39.9, 116.4" onChange={e => { controller.current?.abort(); setBusy(false); setQuery(e.target.value); setResults([]); setMessage(''); }} /><button type="submit" disabled={busy}>{busy ? '搜索中…' : '搜索'}</button></div>
    <p className="search-hint">经纬度按“纬度, 经度”输入</p>
    <div role="status">{message}</div>
    {results.length > 0 && <ul className="search-results">{results.map(place => <li key={place.id}><button type="button" onClick={() => { onSelect(place); setResults([]); setMessage('已定位：'+place.name); }}><strong>{place.name}</strong><small>{place.detail}</small></button></li>)}</ul>}
    <a className="search-hint" href="https://open-meteo.com/en/docs/geocoding-api" target="_blank" rel="noreferrer">地名：Open-Meteo / GeoNames；国家：mledoze/countries</a>
  </form>;
}
