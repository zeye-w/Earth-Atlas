"""
Planet maps for the solar system's close views, from Solar System Scope
(solarsystemscope.com/textures, CC BY 4.0): equirectangular 2048x1024 JPEGs,
and Saturn's ring as a 1024x64 PNG strip (inner edge left, outer right) with
its transparency.

  python3 scripts/planets/build-planets.py <source dir> <out dir>
"""
import os, sys
import cv2

src, out = sys.argv[1:3]
os.makedirs(out, exist_ok=True)
MAPS = {"mercury": "2k_mercury.jpg", "venus": "2k_venus_atmosphere.jpg", "mars": "2k_mars.jpg", "jupiter": "2k_jupiter.jpg",
        "saturn": "2k_saturn.jpg", "uranus": "2k_uranus.jpg", "neptune": "2k_neptune.jpg"}
for name, file in MAPS.items():
    img = cv2.imread(os.path.join(src, file), cv2.IMREAD_COLOR)
    if img is None: raise SystemExit("cannot read " + file)
    img = cv2.resize(img, (2048, 1024), interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(out, name + ".jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 85, cv2.IMWRITE_JPEG_PROGRESSIVE, 1])
ring = cv2.imread(os.path.join(src, "2k_saturn_ring_alpha.png"), cv2.IMREAD_UNCHANGED)
if ring is None: raise SystemExit("cannot read the ring")
print("ring", ring.shape, ring.dtype)
if ring.ndim == 2: ring = cv2.cvtColor(ring, cv2.COLOR_GRAY2BGRA)
if ring.shape[2] == 3: ring = cv2.cvtColor(ring, cv2.COLOR_BGR2BGRA)
# The source strip is horizontal (inner to outer); keep that, at a modest size.
if ring.shape[0] > ring.shape[1]: ring = cv2.rotate(ring, cv2.ROTATE_90_COUNTERCLOCKWISE)
ring = cv2.resize(ring, (1024, 64), interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(out, "saturn-ring.png"), ring, [cv2.IMWRITE_PNG_COMPRESSION, 9])
for f in sorted(os.listdir(out)): print(f"{os.path.getsize(os.path.join(out, f)) / 1024:8.0f} KB {f}")
