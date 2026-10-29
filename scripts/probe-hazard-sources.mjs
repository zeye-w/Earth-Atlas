// Temporary: inspect natural-event and tropical-cyclone feeds (shape, size, CORS).
const ORIGIN = "https://earth-atlas.edwardlab.workers.dev";
const urls = [
  "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30",
  "https://eonet.gsfc.nasa.gov/api/v3/categories",
  "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&alertlevel=green;orange;red",
  "https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtypes=TC",
  "https://www.nhc.noaa.gov/CurrentStorms.json",
];
for (const url of urls) {
  try {
    const started = Date.now();
    const response = await fetch(url, { headers: { Origin: ORIGIN, "User-Agent": "TerraScope/1.0 (+https://github.com/zeye-w/Earth-Atlas)", Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    console.log("\n==", url, "\nHTTP", response.status, "ms", Date.now() - started, "bytes", text.length, "type", response.headers.get("content-type"), "ACAO", response.headers.get("access-control-allow-origin"));
    let json; try { json = JSON.parse(text); } catch { console.log(text.slice(0, 800)); continue; }
    if (json.events) {
      console.log("events", json.events.length, "categories", JSON.stringify([...new Set(json.events.map(e => e.categories?.[0]?.id))]));
      console.log(JSON.stringify(json.events.slice(0, 2)).slice(0, 2500));
      const byCat = {};
      for (const e of json.events) { const c = e.categories?.[0]?.id; byCat[c] = (byCat[c] ?? 0) + 1; }
      console.log("byCategory", JSON.stringify(byCat), "geometry counts", JSON.stringify(json.events.slice(0, 20).map(e => [e.categories?.[0]?.id, e.geometry?.length, e.geometry?.[0]?.type])));
      const storm = json.events.find(e => e.categories?.[0]?.id === "severeStorms");
      if (storm) console.log("STORM", JSON.stringify(storm).slice(0, 2500));
    } else if (json.features) {
      console.log("features", json.features.length);
      console.log(JSON.stringify(json.features.slice(0, 2)).slice(0, 3000));
    } else console.log(JSON.stringify(json).slice(0, 2500));
  } catch (error) { console.log("\n==", url, "FAILED", String(error)); }
}
// One GDACS cyclone in detail: its geometry (track, forecast, cone).
try {
  const list = await (await fetch("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC", { signal: AbortSignal.timeout(30_000) })).json();
  const feature = list.features?.[0];
  if (feature) {
    const p = feature.properties;
    console.log("\nGDACS TC properties", JSON.stringify(p).slice(0, 2000));
    const geo = p.url?.geometry;
    if (geo) {
      const r = await fetch(geo, { signal: AbortSignal.timeout(30_000) });
      const t = await r.text();
      console.log("geometry HTTP", r.status, "bytes", t.length);
      const g = JSON.parse(t);
      console.log("geometry features", g.features?.length, JSON.stringify(g.features?.map(f => [f.geometry?.type, f.properties?.Class ?? f.properties?.class, Object.keys(f.properties ?? {}).slice(0, 12)])).slice(0, 2500));
      console.log(JSON.stringify(g.features?.slice(0, 3)).slice(0, 2500));
    }
  }
} catch (error) { console.log("GDACS detail FAILED", String(error)); }
