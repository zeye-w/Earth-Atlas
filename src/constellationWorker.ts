/**
 * Propagates every satellite of a constellation (SGP4) off the main thread.
 * Messages:
 *   in  { type: "init", records: OmmRecord[] }        -> out { type: "ready", count }
 *   in  { type: "positions", id, time }               -> out { type: "positions", id, time, positions, flags }
 * positions: Float64Array of Earth-fixed x, y, z in metres per satellite;
 * flags: 0 = no reliable position, 1 = in Earth's shadow, 2 = sunlit.
 */
import { eciToEcf, gstime, json2satrec, propagate } from "satellite.js";
import { CONSTELLATION_MAX_ELEMENT_AGE_DAYS, epochOf, type OmmRecord } from "./constellationData.ts";
import { inSunlight } from "./satelliteTelemetry.ts";

type SatRec = ReturnType<typeof json2satrec>;
const MAX_AGE_MS = CONSTELLATION_MAX_ELEMENT_AGE_DAYS * 86_400_000;
let satellites: { satrec: SatRec; epochMs: number }[] = [];

export function propagateAll(time: number, positions: Float64Array, flags: Uint8Array): void {
  const date = new Date(time);
  const gmst = gstime(date);
  for (let i = 0; i < satellites.length; i++) {
    const { satrec, epochMs } = satellites[i];
    flags[i] = 0;
    if (Math.abs(time - epochMs) > MAX_AGE_MS) continue;
    const eci = propagate(satrec, date)?.position;
    if (!eci || typeof eci !== "object" || !Number.isFinite(eci.x)) continue;
    const ecf = eciToEcf(eci, gmst);
    const r = Math.hypot(ecf.x, ecf.y, ecf.z);
    // Decayed or diverged solutions: below 100 km or beyond 100,000 km.
    if (!(r > 6471 && r < 106_371)) continue;
    positions[i * 3] = ecf.x * 1000;
    positions[i * 3 + 1] = ecf.y * 1000;
    positions[i * 3 + 2] = ecf.z * 1000;
    flags[i] = inSunlight(ecf, date) ? 2 : 1;
  }
}

export function initSatellites(records: readonly OmmRecord[]): number {
  // CelesTrak CSV values are the OMM fields json2satrec reads.
  satellites = records.map((record) => ({ satrec: json2satrec(record as unknown as Parameters<typeof json2satrec>[0]), epochMs: epochOf(record).getTime() }));
  return satellites.length;
}

// Worker entry (not run when imported by tests).
const scope = globalThis as unknown as { postMessage?: (message: unknown, transfer?: Transferable[]) => void; onmessage?: unknown; WorkerGlobalScope?: unknown };
if (typeof scope.WorkerGlobalScope !== "undefined") {
  scope.onmessage = (event: MessageEvent) => {
    const message = event.data as { type: string; records?: OmmRecord[]; id?: number; time?: number };
    if (message.type === "init" && message.records) {
      scope.postMessage!({ type: "ready", count: initSatellites(message.records) });
    } else if (message.type === "positions" && typeof message.time === "number") {
      const positions = new Float64Array(satellites.length * 3);
      const flags = new Uint8Array(satellites.length);
      propagateAll(message.time, positions, flags);
      scope.postMessage!({ type: "positions", id: message.id, time: message.time, positions, flags }, [positions.buffer, flags.buffer]);
    }
  };
}
