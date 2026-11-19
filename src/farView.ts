/**
 * "Far view": with the camera beyond about three times the geostationary
 * distance the ground is a few hundred pixels across, so ground-level detail
 * (cities, place names, aircraft, low-orbit satellites) is invisible clutter
 * that still costs work every frame. Layers check this switch to pause and
 * hide that detail, keeping their data so that coming back is immediate; the
 * sky box uses the freed budget for sharper faces.
 */
export const FAR_ENTER_M = 100_000_000;
/** Leave a little closer than the entry, so hovering at the boundary does not flicker. */
export const FAR_EXIT_M = 80_000_000;

let far = false;
const listeners = new Set<(far: boolean) => void>();

export const isFarView = (): boolean => far;

/** The far-view state for a camera height (metres above the ellipsoid), with hysteresis. */
export function farViewFor(height: number, current: boolean): boolean {
  return current ? height > FAR_EXIT_M : height > FAR_ENTER_M;
}

export function setFarView(value: boolean): void {
  if (value === far) return;
  far = value;
  for (const listener of listeners) listener(far);
}

export function onFarView(listener: (far: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
