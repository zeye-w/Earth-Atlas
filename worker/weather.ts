import { parseWeather } from "../src/weatherData.ts";
let cached: { body: string; at: number } | undefined;
let pending: Promise<string> | undefined;
const RELEASE =
  "https://github.com/zeye-w/Earth-Atlas/releases/download/weather-data/latest.json";
export async function weatherResponse(
  request: Request,
  assets: { fetch: (request: Request) => Promise<Response> },
): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method))
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const now = Date.now();
  const load = async () => {
    try {
      const response = await fetch(RELEASE, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "Earth-Atlas weather" },
      });
      if (!response.ok) throw Error("Weather release unavailable");
      // The generated JSON is under 2 MB; reject oversized responses before parsing.
      const reader = response.body?.getReader();
      if (!reader) throw Error("Empty weather response");
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > 2_000_000) {
          await reader.cancel();
          throw Error("Oversized weather response");
        }
        chunks.push(value);
      }
      const buffer = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }
      const body = new TextDecoder().decode(buffer);
      parseWeather(JSON.parse(body));
      return body;
    } catch {
      const fallback = await assets.fetch(
        new Request(new URL("/data/weather/latest.json", request.url)),
      );
      if (!fallback.ok) throw Error("No weather snapshot");
      const body = await fallback.text();
      parseWeather(JSON.parse(body));
      return body;
    }
  };
  try {
    if (!cached || now - cached.at > 900_000) {
      pending ??= load()
        .then((body) => {
          cached = { body, at: Date.now() };
          return body;
        })
        .finally(() => {
          pending = undefined;
        });
      await pending;
    }
    parseWeather(JSON.parse(cached!.body));
    return new Response(request.method === "HEAD" ? null : cached!.body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Weather data unavailable or expired" }),
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
