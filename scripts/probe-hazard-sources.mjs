// Temporary: inspect GDACS tropical-cyclone geometry (track, forecast, cone) for current storms.
const list = await (await fetch("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC", { signal: AbortSignal.timeout(30_000) })).json();
const current = list.features.filter(f => f.properties.iscurrent === "true");
console.log("current TC", current.length, current.map(f => f.properties.eventname + "/" + f.properties.alertlevel + "/" + f.properties.source).join(", "));
for (const feature of current.slice(0, 2)) {
  const g = await (await fetch(feature.properties.url.geometry, { signal: AbortSignal.timeout(30_000) })).json();
  const classes = {};
  for (const f of g.features) { const c = f.properties.Class; classes[c] = (classes[c] ?? 0) + 1; }
  console.log("\n==", feature.properties.eventname, "classes", JSON.stringify(classes));
  const seen = new Set();
  for (const f of g.features) {
    const c = f.properties.Class;
    if (seen.has(c) || c.startsWith("Poly_Green") || c === "Poly_Orange" || c === "Poly_Red") continue;
    seen.add(c);
    const p = { ...f.properties }; for (const k of ["htmldescription", "icon", "iconoverall", "url", "description", "name", "glide", "affectedcountries"]) delete p[k];
    console.log(c, f.geometry.type, JSON.stringify(f.geometry.coordinates).slice(0, 200), JSON.stringify(p).slice(0, 900));
  }
  const details = await (await fetch(feature.properties.url.details, { signal: AbortSignal.timeout(30_000) })).json();
  const dp = details.properties ?? details;
  console.log("details keys", Object.keys(dp).join(","));
  console.log("details sample", JSON.stringify(dp).slice(0, 1500));
}
