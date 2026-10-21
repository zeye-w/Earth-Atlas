/**
 * Asynchronous scene updates that are not map tiles (e.g. constellation
 * positions from a worker). Recording mode waits for these as well as for
 * the tiles before taking a frame, so every frame shows a settled scene.
 */
let pending = 0;

export function beginWork(): () => void {
  pending++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    pending--;
  };
}

export function hasPendingWork(): boolean {
  return pending > 0;
}
