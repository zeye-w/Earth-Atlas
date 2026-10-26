import { planError, type SpaceSite } from "./spacePlan.ts";
let snapshot: {
  sites: SpaceSite[]; relay: boolean; tilt: number; zoom: number; heading: number; reset: number;
  phase: "idle" | "flying" | "playing" | "complete"; elapsed: number; message: string;
} = {
  sites: [
    { label: "北京", longitude: 116.4074, latitude: 39.9042, kind: "fireworks" },
    { label: "上海", longitude: 121.4737, latitude: 31.2304, kind: "rocket" },
    { label: "东京", longitude: 139.6503, latitude: 35.6762, kind: "fireworks" },
  ],
  relay: false, tilt: 20, zoom: 1.15, heading: 0, reset: 0, phase: "idle", elapsed: 0, message: "",
};
const listeners = new Set<() => void>();
export const getSpaceState = () => snapshot;
export function subscribeSpace(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function updateSpace(patch: Partial<typeof snapshot>) { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); }
export function addSpaceSite(site: SpaceSite) {
  const error = planError([...snapshot.sites, site]);
  if (error) { updateSpace({ message: error }); return; }
  updateSpace({ sites: [...snapshot.sites, site], message: "" });
}
