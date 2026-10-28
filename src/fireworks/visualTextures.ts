import { BlendOption } from "cesium";

/**
 * Blend mode for every soft-edged effect billboard (halos, smoke). With
 * BlendOption.TRANSLUCENT Cesium writes depth in the translucent pass "in lieu
 * of sorting", so an unsorted near puff hides the puffs behind it inside its
 * square: hard circular edges and dark holes in smoke. This mode's translucent
 * pass leaves depth alone. shaderWarmup.ts must use the same mode.
 */
export const EFFECT_BLEND = BlendOption.OPAQUE_AND_TRANSLUCENT;

const textures = new Map<string, HTMLCanvasElement>();
export function effectTexture(kind: "halo" | "smoke" | "comet") {
  const cached = textures.get(kind); if (cached) return cached;
  const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = kind === "comet" ? 256 : 128;
  const ctx = canvas.getContext("2d");
  if (ctx && kind === "halo") {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.07, "rgba(255,255,255,0.85)");
    g.addColorStop(0.22, "rgba(255,255,255,0.25)"); g.addColorStop(0.55, "rgba(255,255,255,0.05)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  } else if (ctx && kind === "smoke") {
    // A soft body plus a few lumps, all ending well inside the 128 px square
    // so no puff shows the texture's straight edge.
    const blob = (x: number, y: number, radius: number, alpha: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      // Close to a Gaussian, so overlapping puffs show no ring at their edge.
      g.addColorStop(0, `rgba(255,255,255,${alpha})`); g.addColorStop(0.3, `rgba(255,255,255,${alpha * 0.7})`);
      g.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.25})`); g.addColorStop(0.85, `rgba(255,255,255,${alpha * 0.05})`); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    };
    blob(64, 64, 50, 0.42);
    for (let i = 0; i < 12; i++) {
      const angle = i * 2.39996, r = 6 + (i % 4) * 4;
      blob(64 + Math.cos(angle) * r, 64 + Math.sin(angle) * r, 20 + (i % 5) * 3, 0.14);
    }
  } else if (ctx) {
    ctx.save(); ctx.translate(64, 78); ctx.scale(0.4, 1.9);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 78);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.15, "rgba(220,240,255,0.95)");
    g.addColorStop(0.45, "rgba(255,180,80,0.45)"); g.addColorStop(1, "rgba(255,110,30,0)");
    ctx.fillStyle = g; ctx.fillRect(-100, -100, 200, 200); ctx.restore();
    ctx.fillStyle = "rgba(255,250,230,0.98)";
    ctx.beginPath(); ctx.moveTo(64, 34); ctx.lineTo(68, 65); ctx.lineTo(64, 73); ctx.lineTo(60, 65); ctx.closePath(); ctx.fill();
  }
  textures.set(kind, canvas); return canvas;
}
