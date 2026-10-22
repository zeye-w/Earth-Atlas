/**
 * The app's notion of "now". Normally the real time; recording mode can pin
 * it to a virtual instant that advances with the video, so live layers
 * (satellites, Starlink, flights, the Sun) move in video time however slowly
 * frames render. Never set outside recording mode.
 */
let virtualNow: number | null = null;
const listeners = new Set<() => void>();

export const now = (): number => virtualNow ?? Date.now();

export const isVirtualClock = (): boolean => virtualNow !== null;

export function setVirtualNow(time: number | null): void {
  virtualNow = time;
  for (const listener of listeners) listener();
}

/** Called whenever the virtual clock is set or released. */
export function onClockChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
