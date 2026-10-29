/**
 * When the glass panels may blur again. Re-blurring them on every repaint
 * while the globe moves or streams tiles is expensive, so they switch to a
 * solid tint as soon as either starts. The blur returns only after both have
 * stopped for `calmMs`: the tile queue empties and refills many times a
 * second, and following it directly made the panels flicker.
 */
export function createGlassCalm(setBusy: (busy: boolean) => void, calmMs: number) {
  let moving = false, loading = false, busy = false, timer: ReturnType<typeof setTimeout> | undefined;
  const update = () => {
    clearTimeout(timer);
    timer = undefined;
    if (moving || loading) {
      if (!busy) { busy = true; setBusy(true); }
    } else if (busy) {
      timer = setTimeout(() => { timer = undefined; busy = false; setBusy(false); }, calmMs);
    }
  };
  return {
    moving(value: boolean) { if (moving !== value) { moving = value; update(); } },
    loading(value: boolean) { if (loading !== value) { loading = value; update(); } },
    dispose() { clearTimeout(timer); },
  };
}
