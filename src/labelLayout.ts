/** Deterministic screen-space placement; never shifts a name off its feature. */
export interface LabelBox { id: string; x: number; y: number; width: number; height: number; priority: number; group?: string }
export function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return Math.abs(a.x-b.x) < (a.width+b.width)/2 && Math.abs(a.y-b.y) < (a.height+b.height)/2;
}
export function layoutLabels(candidates: readonly LabelBox[], reserved: readonly LabelBox[], width: number, height: number): Set<string> {
  const accepted: LabelBox[] = [...reserved];
  const groups = new Set<string>();
  const visible = new Set<string>();
  for (const box of [...candidates].sort((a,b) => b.priority-a.priority || a.id.localeCompare(b.id))) {
    if (box.x-box.width/2 < 0 || box.y-box.height/2 < 0 || box.x+box.width/2 > width || box.y+box.height/2 > height) continue;
    if (box.group && groups.has(box.group)) continue;
    if (accepted.some(other => boxesOverlap(box,other))) continue;
    accepted.push(box); visible.add(box.id);
    if (box.group) groups.add(box.group);
  }
  return visible;
}
