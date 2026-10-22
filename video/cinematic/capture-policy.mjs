/** Parse sparse recovery selections as well as the existing contiguous ranges. */
export function selectedFrames(spec, count) {
  if (spec === "preview") return [...new Set(Array.from({ length: Math.ceil(count / 24) }, (_, i) => i * 24).concat([216, 357, 380, 393, 410, 576, 648, count - 1]))].filter(f => f < count).sort((a,b)=>a-b);
  const result = new Set();
  for (const token of spec.split(",")) {
    const match = token.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error("Invalid frame selection: " + token);
    const start = Number(match[1]), end = Number(match[2] ?? match[1]);
    if (start > end || start < 0 || end >= count) throw new Error("Frame selection outside film: " + token);
    for (let frame = start; frame <= end; frame++) result.add(frame);
  }
  return [...result].sort((a,b)=>a-b);
}

/** Keep camera and virtual time fixed; only continue waiting for the same scene. */
export async function settleAfterTimeout(initialSettled, wait, onRetry = () => {}, budgets = [90_000, 180_000]) {
  if (initialSettled) return { settled: true, retries: 0 };
  for (let i = 0; i < budgets.length; i++) {
    onRetry(i + 1, budgets[i]);
    if (await wait(budgets[i])) return { settled: true, retries: i + 1 };
  }
  return { settled: false, retries: budgets.length };
}
