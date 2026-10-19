/**
 * Refresh src/data/volcanoes.json from the Smithsonian Global Volcanism
 * Program "Volcanoes of the World" Holocene list (GeoServer WFS).
 * Run by .github/workflows/volcano-data.yml; requires network access.
 */
import { writeFileSync } from "node:fs";

const URL = "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature" +
  "&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=application/json";

const response = await fetch(URL, {
  signal: AbortSignal.timeout(60000),
  headers: { Accept: "application/json", Origin: "https://earth-atlas.edwardlab.workers.dev" },
});
console.log("GVP HTTP", response.status, "content-type", response.headers.get("content-type"),
  "Access-Control-Allow-Origin", response.headers.get("access-control-allow-origin") ?? "(missing)");
if (!response.ok) throw new Error("GVP HTTP " + response.status);
const json = await response.json();
const features = json.features ?? [];
console.log("features:", features.length);
console.log("first properties:", JSON.stringify(features[0]?.properties ?? {}).slice(0, 800));

const pick = (props, ...names) => {
  for (const name of names) if (props[name] !== undefined && props[name] !== null && props[name] !== "") return props[name];
  return null;
};
const volcanoes = [];
for (const feature of features) {
  const props = feature.properties ?? {};
  const coordinates = feature.geometry?.coordinates;
  const lon = Number(pick(props, "Longitude", "longitude") ?? coordinates?.[0]);
  const lat = Number(pick(props, "Latitude", "latitude") ?? coordinates?.[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) continue;
  const lastEruption = Number(pick(props, "Last_Eruption_Year", "LastEruptionYear"));
  const elevation = Number(pick(props, "Elevation", "elevation"));
  volcanoes.push({
    id: Number(pick(props, "Volcano_Number", "VolcanoNumber")) || null,
    name: String(pick(props, "Volcano_Name", "VolcanoName") ?? "Unnamed").slice(0, 60),
    country: String(pick(props, "Country", "country") ?? "").slice(0, 60),
    type: String(pick(props, "Primary_Volcano_Type", "PrimaryVolcanoType") ?? "").slice(0, 60),
    lastEruption: Number.isFinite(lastEruption) ? lastEruption : null,
    elevation: Number.isFinite(elevation) ? Math.round(elevation) : null,
    lon: Math.round(lon * 1000) / 1000,
    lat: Math.round(lat * 1000) / 1000,
  });
}
console.log("parsed volcanoes:", volcanoes.length, "with eruption year:", volcanoes.filter((v) => v.lastEruption !== null).length);
console.log("sample:", JSON.stringify(volcanoes.slice(0, 3)));
if (volcanoes.length < 1000) throw new Error("Unexpectedly few volcanoes; refusing to overwrite data");
volcanoes.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
writeFileSync("src/data/volcanoes.json", JSON.stringify({
  source: "Global Volcanism Program, Smithsonian Institution. Volcanoes of the World (Holocene list), retrieved via GVP GeoServer WFS",
  retrieved: new Date().toISOString().slice(0, 10),
  volcanoes,
}));
console.log("wrote src/data/volcanoes.json");
