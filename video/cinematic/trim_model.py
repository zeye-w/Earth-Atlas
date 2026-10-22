"""Drop the stray parts of NASA's ISS (B) model: seven small meshes that float
about 40 units above the station (truss and cylinder offcuts left in the file).
usage: trim_model.py iss.glb   (rewritten in place)
"""
import json
import struct
import sys

STRAY = {"bendedtru1", "bendedtru2", "bendedtru3", "bendedtrus", "pCylinder1", "pCylinder2", "pCylinder8"}

path = sys.argv[1]
data = open(path, "rb").read()
json_length = struct.unpack("<I", data[12:16])[0]
gltf = json.loads(data[20:20 + json_length])
rest = data[20 + json_length:]
stray = {i for i, node in enumerate(gltf["nodes"]) if node.get("name") in STRAY}
for node in gltf["nodes"]:
    if "children" in node:
        node["children"] = [c for c in node["children"] if c not in stray]
for scene in gltf.get("scenes", []):
    scene["nodes"] = [n for n in scene["nodes"] if n not in stray]
chunk = json.dumps(gltf, separators=(",", ":")).encode()
chunk += b" " * (-len(chunk) % 4)
header = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(chunk) + len(rest)) + struct.pack("<I4s", len(chunk), b"JSON")
open(path, "wb").write(header + chunk + rest)
print("trimmed", len(stray), "stray nodes from", path)
