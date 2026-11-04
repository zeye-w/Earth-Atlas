import { useMemo } from "react";
import { fetchHazards, type HazardSnapshot } from "../hazardData";
import { fetchLaunches, type LaunchSnapshot } from "../launchData";
import { fetchQuakes, type Earthquake } from "../earthquakeData";
import { fetchGeomagnetic } from "../geomagnetic";
import { usePolledData } from "../hooks/usePolledData";
import { pickHighlights, type Highlight } from "../highlights";
import { now } from "../clock";

const REFRESH_MS = 15 * 60_000;

interface Sources { hazards: HazardSnapshot | null; launches: LaunchSnapshot | null; quakes: Earthquake[] | null; kp: number | null }

/** Each source is optional: one feed down only drops its highlights. */
async function fetchSources(signal: AbortSignal): Promise<Sources> {
  const [hazards, launches, quakes, geomagnetic] = await Promise.allSettled([
    fetchHazards(signal), fetchLaunches(signal), fetchQuakes("day", signal), fetchGeomagnetic(signal),
  ]);
  return {
    hazards: hazards.status === "fulfilled" ? hazards.value : null,
    launches: launches.status === "fulfilled" ? launches.value : null,
    quakes: quakes.status === "fulfilled" ? quakes.value : null,
    kp: geomagnetic.status === "fulfilled" ? geomagnetic.value.now.kp : null,
  };
}

/** Today's highlights from the live feeds, refreshed every 15 minutes while the tab is visible. */
export function useHighlights(enabled: boolean): { highlights: Highlight[]; ready: boolean } {
  const poll = usePolledData(fetchSources, { enabled, intervalMs: REFRESH_MS, refreshOnVisible: true, keepDataOnError: true });
  const highlights = useMemo(() => (poll.data ? pickHighlights({ ...poll.data, now: now() }) : []), [poll.data]);
  return { highlights, ready: poll.data !== null };
}
