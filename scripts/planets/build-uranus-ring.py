"""
Radial profile of Uranus's rings for the ring shader (src/planetSpheres.ts):
public/planets/uranus-ring.png, 2048 × 4 RGBA, s from 37,850 km (inside the
faint ζ ring) to 51,300 km (just outside ε).

  python3 scripts/planets/build-uranus-ring.py public/planets/uranus-ring.png

Ring radii, widths and normal optical depths after French et al. (1991,
Uranus, Univ. of Arizona Press) and Esposito (2002). The real rings are a
few km wide (ε about 58 km) and very dark, so at the distance that shows the
whole planet (a few hundred km a pixel) they would not show at all, as they
do not to the eye. They are drawn at their true radii with their relative
opacity, but widened to at least WIDTH_MIN_KM so that they can be seen.
"""
import sys
import cv2
import numpy as np

INNER, OUTER, N = 37_850.0, 51_300.0, 2048
WIDTH_MIN_KM = 110.0
# name, radius km, true width km, normal optical depth
RINGS = [
    ("6", 41_837, 1.6, 0.3), ("5", 42_234, 2.2, 0.5), ("4", 42_571, 2.4, 0.3),
    ("alpha", 44_718, 7.2, 0.4), ("beta", 45_661, 8.2, 0.25), ("eta", 47_176, 1.6, 0.4),
    ("gamma", 47_627, 3.8, 1.5), ("delta", 48_300, 6.1, 0.4), ("lambda", 50_023, 2.0, 0.1),
    ("epsilon", 51_149, 58.0, 0.8),
]
r = INNER + (np.arange(N) + 0.5) / N * (OUTER - INNER)
alpha = np.zeros(N)
# ζ (1986U2R): a broad, very faint dusty band inside ring 6.
alpha += 0.05 * np.clip((r - 37_850) / 800, 0, 1) * np.clip((41_350 - r) / 800, 0, 1)
for name, radius, width, tau in RINGS:
    w = max(width * (2.2 if name == "epsilon" else 1.0), WIDTH_MIN_KM)
    peak = 0.22 + 0.45 * min(tau, 1.0)
    # A soft-edged band: flat core, Gaussian shoulders.
    d = np.abs(r - radius)
    alpha = np.maximum(alpha, peak * np.exp(-np.maximum(d - w / 4, 0) ** 2 / (2 * (w / 4) ** 2)))
grey = np.where(r > 50_500, 0.72, 0.62)  # ε, the brightest, slightly lighter
rgba = np.zeros((4, N, 4), np.uint8)
rgba[..., 0] = rgba[..., 1] = np.clip(grey * 255, 0, 255).astype(np.uint8)
rgba[..., 2] = np.clip(grey * 1.04 * 255, 0, 255).astype(np.uint8)
rgba[..., 3] = np.clip(alpha * 255, 0, 255).astype(np.uint8)
# OpenCV writes BGRA.
cv2.imwrite(sys.argv[1], rgba[..., [2, 1, 0, 3]])
print("rings", len(RINGS), "max alpha", float(alpha.max()))
