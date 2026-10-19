const samples = [
  "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=JSON",
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=STATIONS&FORMAT=JSON",
];
let errors = 0;
for (const url of samples) {
  try {
    const response = await fetch(url, {
      headers: { Origin: "https://earth-atlas.edwardlab.workers.dev", Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.text();
    const cors = response.headers.get("access-control-allow-origin");
    let data = null;
    try { data = JSON.parse(body); } catch {}
    console.log(JSON.stringify({
      request: new URL(url).search,
      status: response.status,
      type: response.headers.get("content-type"),
      cors,
      count: Array.isArray(data) ? data.length : null,
      keys: Array.isArray(data) && data[0] ? Object.keys(data[0]).slice(0,18) : [],
      excerpt: !data ? body.slice(0,150) : undefined,
    }));
    if (!response.ok || !Array.isArray(data) || !data.length) errors++;
  } catch (error) {
    console.log("Probe failure: " + String(error));
    errors++;
  }
}
if (errors) process.exitCode = 1;
