import { useEffect, useMemo, useRef } from "react";
import type { Viewer } from "cesium";
import { FLIGHT_REFRESH_MS, fetchFlights, type Flight, type FlightSource } from "../flightData";
import { FlightOverlay } from "../flightOverlay";
import { usePolledData } from "../hooks/usePolledData";
import { now, onClockChange } from "../clock";

export interface FlightState {
  status: "idle" | "loading" | "ready" | "error";
  source: FlightSource | null;
  /** Data time, ms since epoch. */
  time: number | null;
  total: number;
  airborne: number;
}

const ADVANCE_MS = 1_000;

/**
 * Live aircraft positions. The feed has no history, so the layer only runs
 * while the timeline is live (`active`); away from live nothing is drawn.
 */
export function useFlights(viewer: Viewer | null, active: boolean) {
  const overlayRef = useRef<FlightOverlay | null>(null);
  const poll = usePolledData(fetchFlights, { enabled: active, intervalMs: FLIGHT_REFRESH_MS, refreshOnVisible: true, keepDataOnError: true });

  useEffect(() => {
    if (!viewer || !active) return;
    const overlay = new FlightOverlay(viewer);
    overlayRef.current = overlay;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") overlay.advance(now());
    }, ADVANCE_MS);
    // Recording mode moves the clock frame by frame: follow at once.
    const offClock = onClockChange(() => overlay.advance(now()));
    return () => {
      offClock();
      window.clearInterval(timer);
      overlay.dispose();
      overlayRef.current = null;
    };
  }, [viewer, active]);

  useEffect(() => {
    if (poll.data) overlayRef.current?.setFlights(poll.data.flights, now());
  }, [poll.data, viewer, active]);

  const state = useMemo<FlightState>(() => {
    const data = poll.data;
    const flights = data?.flights ?? [];
    return {
      status: !active ? "idle" : data ? "ready" : poll.status === "error" ? "error" : poll.status === "idle" ? "idle" : "loading",
      source: data?.source ?? null,
      time: data?.time ?? null,
      total: flights.length,
      airborne: flights.reduce((n, f) => n + (f.altitude === null ? 0 : 1), 0),
    };
  }, [poll.data, poll.status, active]);

  const describe = (index: number): Flight | null => overlayRef.current?.flight(index) ?? null;
  const setAlpha = (alpha: number) => overlayRef.current?.setAlpha(alpha);
  const locate = (hex: string) => overlayRef.current?.locate(hex, now()) ?? null;
  return { state, describe, setAlpha, locate };
}
