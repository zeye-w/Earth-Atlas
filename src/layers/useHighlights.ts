import { useMemo } from "react";
import { fetchHazards, type HazardSnapshot } from "../hazardData";
import { fetchLaunches, type LaunchSnapshot } from "../launchData";
import { fetchQuakes, type Earthquake } from "../earthquakeData";
import { fetchGeomagnetic } from "../geomagnetic";
import { usePolledData } from "../hooks/usePolledData";
import { pickHighlights, type Highlight } from "../highlights";
import { now } from "../clock";
import { loadAstronomy } from "./useAstronomy";
import type { Eclipse, ShowerOutlook } from "../astronomy/index";
import { fetchSolarActivity, type Flare } from "../solarActivity";

const REFRESH_MS = 15 * 60_000;

interface Sources { hazards: HazardSnapshot | null; launches: LaunchSnapshot | null; quakes: Earthquake[] | null; kp: number | null;
  sky: { eclipses: Eclipse[]; showers: ShowerOutlook[] } | null; flares: Flare[] | null }

const HOUR = 3_600_000;
/** Eclipses and meteor peaks around now, from the astronomy code (loaded on demand). */
async function skySoon(): Promise<Sources["sky"]> {
  const astronomy = await loadAstronomy();
  const at = now();
  return { eclipses: astronomy.listEclipses(at - 6 * HOUR, at + 8 * 24 * HOUR), showers: astronomy.showerOutlook(at - 24 * HOUR) };
}

/** Each source is optional: one feed down only drops its highlights. */
async function fetchSources(signal: AbortSignal): Promise<Sources> {
  const [hazards, launches, quakes, geomagnetic, sky, solar] = await Promise.allSettled([
    fetchHazards(signal), fetchLaunches(signal), fetchQuakes("day", signal), fetchGeomagnetic(signal), skySoon(), fetchSolarActivity(signal),
  ]);
  return {
    hazards: hazards.status === "fulfilled" ? hazards.value : null,
    launches: launches.status === "fulfilled" ? launches.value : null,
    quakes: quakes.status === "fulfilled" ? quakes.value : null,
    kp: geomagnetic.status === "fulfilled" ? geomagnetic.value.now.kp : null,
    sky: sky.status === "fulfilled" ? sky.value : null,
    flares: solar.status === "fulfilled" ? solar.value.flares : null,
  };
}

/** Today's highlights from the live feeds, refreshed every 15 minutes while the tab is visible. */
export function useHighlights(enabled: boolean): { highlights: Highlight[]; ready: boolean } {
  const poll = usePolledData(fetchSources, { enabled, intervalMs: REFRESH_MS, refreshOnVisible: true, keepDataOnError: true });
  const highlights = useMemo(() => (poll.data ? pickHighlights({ ...poll.data, now: now() }) : []), [poll.data]);
  return { highlights, ready: poll.data !== null };
}
