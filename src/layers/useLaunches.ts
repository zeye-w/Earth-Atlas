import { useEffect, useRef } from "react";
import type { Viewer } from "cesium";
import { fetchLaunches, LAUNCH_REFRESH_MS, type LaunchSnapshot } from "../launchData";
import { LaunchOverlay } from "../launchOverlay";
import { usePolledData, type PollStatus } from "../hooks/usePolledData";
import { now } from "../clock";

export interface LaunchState {
  status: PollStatus;
  snapshot: LaunchSnapshot | null;
}

/** The real launch calendar: pad markers on the globe plus the snapshot for the panel list. */
export function useLaunches(viewer: Viewer | null, visible: boolean, selectedPadId: string | null): LaunchState {
  const overlayRef = useRef<LaunchOverlay | null>(null);
  const poll = usePolledData(fetchLaunches, { enabled: visible, intervalMs: LAUNCH_REFRESH_MS, refreshOnVisible: true, keepDataOnError: true });

  useEffect(() => {
    if (!viewer || !visible) return;
    const overlay = new LaunchOverlay(viewer);
    overlayRef.current = overlay;
    return () => {
      overlay.dispose();
      overlayRef.current = null;
    };
  }, [viewer, visible]);

  useEffect(() => {
    if (poll.data) overlayRef.current?.setLaunches(poll.data.launches, now());
  }, [poll.data, viewer, visible]);

  useEffect(() => {
    overlayRef.current?.setSelected(selectedPadId);
  }, [selectedPadId, poll.data, viewer, visible]);

  return { status: poll.status, snapshot: poll.data };
}
