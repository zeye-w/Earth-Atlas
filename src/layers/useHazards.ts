import { useEffect, useMemo, useRef } from "react";
import type { Viewer } from "cesium";
import { cmaLevel, fetchHazards, HAZARD_REFRESH_MS, saffirSimpsonLevel, type EventCategory, type HazardSnapshot } from "../hazardData";
import { HazardOverlay } from "../hazardOverlay";
import { usePolledData, type PollStatus } from "../hooks/usePolledData";
import { stormDisplayName } from "../typhoonNames";
import type { TimeController, TimeState } from "../timeline";
import type { Locale } from "../i18n";
import { now } from "../clock";

export interface HazardState { status: PollStatus; snapshot: HazardSnapshot | null }

const sceneTime = (state: TimeState) => (state.live ? now() : state.time);
/** Chinese readers get the CMA grades, English readers Saffir–Simpson. */
export const intensityScale = (locale: Locale) => (locale === "zh" ? cmaLevel : saffirSimpsonLevel);

/** Natural events and tropical cyclones from /api/hazards, following the timeline. */
export function useHazards(viewer: Viewer | null, layers: { events: boolean; storms: boolean }, categories: ReadonlySet<EventCategory>, timeline: TimeController, locale: Locale, selectedStorm: string | null): HazardState {
  const active = layers.events || layers.storms;
  const overlayRef = useRef<HazardOverlay | null>(null);
  const poll = usePolledData(fetchHazards, { enabled: active, intervalMs: HAZARD_REFRESH_MS, refreshOnVisible: true, keepDataOnError: true });

  useEffect(() => {
    if (!viewer || !active) return;
    const overlay = new HazardOverlay(viewer);
    overlayRef.current = overlay;
    const off = timeline.subscribe((state) => overlay.setTime(sceneTime(state)));
    return () => { off(); overlay.dispose(); overlayRef.current = null; };
  }, [viewer, active, timeline]);

  const visible = useMemo(() => ({ events: layers.events, storms: layers.storms, categories }), [layers.events, layers.storms, categories]);
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.set(poll.data, visible, intensityScale(locale), (storm) => stormDisplayName(storm.name, locale));
    overlay.setTime(sceneTime(timeline.getState()));
  }, [poll.data, visible, locale, viewer, active, timeline]);

  useEffect(() => { overlayRef.current?.setSelected(selectedStorm); }, [selectedStorm, poll.data, visible, viewer, active]);

  return { status: poll.status, snapshot: poll.data };
}
