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
    for (let i = 0; i < 18; i++) {
      const angle = i * 2.39996, r = 12 + (i % 5) * 5;
      const x = 64 + Math.cos(angle) * r, y = 64 + Math.sin(angle) * r;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 24 + i % 9);
      g.addColorStop(0, "rgba(255,255,255,0.16)"); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
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
