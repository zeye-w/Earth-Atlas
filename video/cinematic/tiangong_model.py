"""Deterministic, metre-scale schematic of the Tiangong T configuration.

Only stdlib + numpy. glTF +Z forward, +Y zenith, +X cross-track.
Proportions follow the published layout (Tianhe core, Wentian and Mengtian
across the forward node, Tianzhou aft, Shenzhou at the nadir port), with
section changes, docking rings, radiators and segmented solar blankets so it
reads as a spacecraft in close-up. Not an engineering replica or a claim about
the current visiting spacecraft, array angles or attitude.
Usage: python3 video/cinematic/tiangong_model.py out.glb
"""
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np

MATERIALS = [
    {'name': 'module', 'pbrMetallicRoughness': {'baseColorFactor': [.88, .88, .85, 1], 'metallicFactor': 0, 'roughnessFactor': .72}},
    {'name': 'solar array', 'doubleSided': True, 'pbrMetallicRoughness': {'baseColorFactor': [.045, .06, .15, 1], 'metallicFactor': .5, 'roughnessFactor': .28}},
    {'name': 'gold frame', 'pbrMetallicRoughness': {'baseColorFactor': [.78, .6, .26, 1], 'metallicFactor': .85, 'roughnessFactor': .35}},
    {'name': 'structure', 'pbrMetallicRoughness': {'baseColorFactor': [.45, .46, .48, 1], 'metallicFactor': .6, 'roughnessFactor': .45}},
    {'name': 'dark band', 'pbrMetallicRoughness': {'baseColorFactor': [.12, .12, .13, 1], 'metallicFactor': .2, 'roughnessFactor': .6}},
    {'name': 'radiator', 'doubleSided': True, 'pbrMetallicRoughness': {'baseColorFactor': [.95, .95, .95, 1], 'metallicFactor': 0, 'roughnessFactor': .4}},
]
MODULE, ARRAY, GOLD, STRUCTURE, BAND, RADIATOR = range(len(MATERIALS))
SEGMENTS = 32


class Geometry:
    def __init__(self):
        self.groups = {i: ([], []) for i in range(len(MATERIALS))}

    def triangle(self, material, points, normals):
        points, normals = np.array(points, dtype=float), np.array(normals, dtype=float)
        face = np.cross(points[1] - points[0], points[2] - points[0])
        if np.linalg.norm(face) < 1e-10:
            return
        if np.dot(face, normals.mean(axis=0)) < 0:
            points, normals = points[[0, 2, 1]], normals[[0, 2, 1]]
        self.groups[material][0].extend(points.tolist())
        self.groups[material][1].extend(normals.tolist())

    def box(self, center, size, material):
        c, h = np.array(center, float), np.array(size, float) / 2
        for axis in range(3):
            u, v = (axis + 1) % 3, (axis + 2) % 3
            for sign in [-1, 1]:
                normal = np.zeros(3)
                normal[axis] = sign
                points = []
                for a, b in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
                    point = c + normal * h
                    point[u] += a * h[u]
                    point[v] += b * h[v]
                    points.append(point)
                for indices in [(0, 1, 2), (0, 2, 3)]:
                    self.triangle(material, [points[i] for i in indices], [normal] * 3)

    def frustum(self, start, end, r0, r1, material=MODULE, caps=True):
        """A cone section from radius r0 at start to r1 at end (a cylinder when equal)."""
        a, b = np.array(start, float), np.array(end, float)
        length = np.linalg.norm(b - a)
        axis = (b - a) / length
        helper = np.eye(3)[np.argmin(np.abs(axis))]
        u = np.cross(axis, helper)
        u /= np.linalg.norm(u)
        v = np.cross(axis, u)
        slope = (r0 - r1) / length
        for i in range(SEGMENTS):
            radial = [math.cos(k * 2 * math.pi / SEGMENTS) * u + math.sin(k * 2 * math.pi / SEGMENTS) * v for k in [i, i + 1]]
            p, q = radial
            n_p, n_q = [(r + slope * axis) / np.linalg.norm(r + slope * axis) for r in radial]
            self.triangle(material, [a + r0*p, b + r1*p, b + r1*q], [n_p, n_p, n_q])
            self.triangle(material, [a + r0*p, b + r1*q, a + r0*q], [n_p, n_q, n_q])
            if caps:
                self.triangle(material, [a, a + r0*p, a + r0*q], [-axis] * 3)
                self.triangle(material, [b, b + r1*p, b + r1*q], [axis] * 3)

    def cylinder(self, start, end, radius, material=MODULE):
        self.frustum(start, end, radius, radius, material)

    def ring(self, center, axis, radius, width=.12, material=BAND):
        """A band slightly proud of a hull: section joints and docking collars."""
        c, d = np.array(center, float), np.array(axis, float) * width / 2
        self.cylinder(c - d, c + d, radius, material)

    def sphere(self, center, radius, material=MODULE):
        c = np.array(center, float)
        def normal(i, j):
            phi, theta = -math.pi/2 + i*math.pi/16, j*math.pi/12
            return np.array([math.cos(phi)*math.cos(theta), math.sin(phi), math.cos(phi)*math.sin(theta)])
        for i in range(16):
            for j in range(24):
                normals = [normal(i, j), normal(i+1, j), normal(i+1, j+1), normal(i, j+1)]
                for indices in [(0, 1, 2), (0, 2, 3)]:
                    ns = [normals[k] for k in indices]
                    self.triangle(material, [c+radius*n for n in ns], ns)

    def wing(self, root, direction, across, length, width, blankets):
        """A flexible array: a mast from the root along `direction`, with
        blanket panels either side of it separated by thin gaps and framed."""
        root, d, w = np.array(root, float), np.array(direction, float), np.array(across, float)
        thickness_axis = np.cross(d, w)
        size = lambda along, wide, thick: np.abs(d)*along + np.abs(w)*wide + np.abs(thickness_axis)*thick
        self.box(root + d*length/2, size(length, .16, .16), GOLD)
        step = length / blankets
        for k in range(blankets):
            centre = root + d*(step*(k + .5))
            for side in [-1, 1]:
                self.box(centre + w*side*(width/4 + .06), size(step - .12, width/2 - .12, .04), ARRAY)
        for side in [-1, 1]:
            self.box(root + d*length/2 + w*side*width/2, size(length, .06, .06), GOLD)
        self.box(root + d*length, size(.06, width, .06), GOLD)

    def radiator(self, center, size):
        self.box(center, size, RADIATOR)


def make_model():
    g = Geometry()
    z_node = 9.7
    # Tianhe, aft to front: resource section, large and small living sections, node.
    g.cylinder([0, 0, -8.3], [0, 0, -5.3], 1.45, STRUCTURE)
    g.ring([0, 0, -5.3], [0, 0, 1], 2.16)
    g.cylinder([0, 0, -5.3], [0, 0, 3.3], 2.1)
    for z in [-1.0, 2.0]:
        g.ring([0, 0, z], [0, 0, 1], 2.13, .08, STRUCTURE)
    g.frustum([0, 0, 3.3], [0, 0, 4.3], 2.1, 1.4)
    g.cylinder([0, 0, 4.3], [0, 0, 8.4], 1.4)
    g.ring([0, 0, 8.4], [0, 0, 1], 1.46)
    g.sphere([0, 0, z_node], 1.4)
    g.ring([0, 0, z_node + 1.4], [0, 0, 1], .7, .3, STRUCTURE)            # forward port
    g.ring([0, 1.4, z_node], [0, 1, 0], .7, .3, STRUCTURE)                # zenith port
    # Body-mounted radiators along the large section, and a dish on a mast.
    for side in [-1, 1]:
        g.radiator([side*2.18, 0, -1.0], [.04, 1.6, 6.0])
    g.cylinder([0, 2.1, 1.0], [0, 3.3, 1.0], .06, STRUCTURE)
    g.frustum([0, 3.3, 1.0], [0, 3.6, 1.0], .1, .55, STRUCTURE)
    # Tianhe's own arrays near the aft end.
    for side in [-1, 1]:
        g.cylinder([side*1.45, 0, -6.8], [side*2.0, 0, -6.8], .1, STRUCTURE)
        g.wing([side*2.0, 0, -6.8], [side, 0, 0], [0, 0, 1], 9.0, 2.6, 6)

    # Wentian (+X) and Mengtian (-X) across the node: adapter, working section, resource section.
    for side in [-1, 1]:
        s = np.array([side, 0, 0])
        at = lambda x, y=0, z=z_node: [side*x, y, z]
        g.ring(at(1.5), s, .7, .3, STRUCTURE)
        g.frustum(at(1.6), at(3.0), 1.4, 2.1)
        g.cylinder(at(3.0), at(13.6), 2.1)
        for x in [3.0, 8.3, 13.6]:
            g.ring(at(x), s, 2.16)
        g.cylinder(at(13.6), at(19.3), 1.6, STRUCTURE)
        g.ring(at(19.3), s, 1.0, .2, BAND)
        g.radiator(at(8.3, 2.2), [7.0, .04, 1.8])                         # zenith radiator
        g.radiator(at(8.3, -2.2), [7.0, .04, 1.8])
        # Large arrays on a yoke at the outer resource section, fore and aft.
        x = 18.8
        g.box(at(x, 0, 0), [.24, .24, 24], GOLD)
        g.cylinder(at(x, 0, z_node - 1.6), at(x, 0, z_node - .1), .3, STRUCTURE)
        for direction in [-1, 1]:
            g.wing(at(x, 0, direction*1.0), [0, 0, direction], [1, 0, 0], 25.0, 3.2, 12)

    # Tianzhou docked aft: collar, cargo section, propulsion section, two arrays.
    g.ring([0, 0, -8.65], [0, 0, 1], .65, .7, STRUCTURE)
    g.cylinder([0, 0, -9.0], [0, 0, -15.0], 1.675)
    g.ring([0, 0, -15.0], [0, 0, 1], 1.72)
    g.frustum([0, 0, -15.0], [0, 0, -15.8], 1.675, 1.45, STRUCTURE)
    g.cylinder([0, 0, -15.8], [0, 0, -19.6], 1.45, STRUCTURE)
    for side in [-1, 1]:
        g.wing([side*1.45, 0, -17.6], [side, 0, 0], [0, 0, 1], 6.5, 2.2, 4)

    # Shenzhou at the node's nadir port: orbital module, capsule, service module, arrays.
    g.ring([0, -1.55, z_node], [0, 1, 0], .65, .3, STRUCTURE)
    g.cylinder([0, -1.7, z_node], [0, -4.3, z_node], 1.1)
    g.frustum([0, -4.3, z_node], [0, -6.4, z_node], .9, 1.25, BAND)
    g.cylinder([0, -6.4, z_node], [0, -9.6, z_node], 1.4)
    g.frustum([0, -9.6, z_node], [0, -10.4, z_node], 1.4, .9, STRUCTURE)
    for side in [-1, 1]:
        g.wing([side*1.4, -8.0, z_node], [side, 0, 0], [0, 1, 0], 7.4, 1.8, 4)
    return g


def write_glb(path):
    geometry = make_model()
    binary = bytearray()
    views, accessors, primitives = [], [], []
    for material, (positions, normals) in geometry.groups.items():
        if not positions:
            continue
        attributes = {}
        for semantic, values in [('POSITION', positions), ('NORMAL', normals)]:
            array = np.array(values, dtype='<f4')
            offset = len(binary)
            binary.extend(array.tobytes())
            views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': array.nbytes, 'target': 34962})
            accessor = {'bufferView': len(views)-1, 'componentType': 5126, 'count': len(array), 'type': 'VEC3'}
            if semantic == 'POSITION':
                accessor.update(min=array.min(axis=0).tolist(), max=array.max(axis=0).tolist())
            accessors.append(accessor)
            attributes[semantic] = len(accessors)-1
        primitives.append({'attributes': attributes, 'material': material, 'mode': 4})
    document = {
        'asset': {'version': '2.0', 'generator': 'Earth-Atlas procedural station schematic'},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'Tiangong schematic, metres'}],
        'meshes': [{'primitives': primitives}], 'buffers': [{'byteLength': len(binary)}],
        'bufferViews': views, 'accessors': accessors, 'materials': MATERIALS,
        'extras': {'units': 'metres', 'schematic': True, 'axes': '+Z forward, +Y zenith, +X cross-track'},
    }
    encoded = json.dumps(document, separators=(',', ':'), ensure_ascii=True).encode()
    encoded += b' ' * (-len(encoded) % 4)
    binary += b'\0' * (-len(binary) % 4)
    output = struct.pack('<4sII', b'glTF', 2, 12+8+len(encoded)+8+len(binary))
    output += struct.pack('<I4s', len(encoded), b'JSON')+encoded
    output += struct.pack('<I4s', len(binary), b'BIN\0')+binary
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(output)
    return document


if __name__ == '__main__':
    document = write_glb(sys.argv[1])
    positions = [a for a in document['accessors'] if 'min' in a]
    print(json.dumps({'file': sys.argv[1], 'min': np.min([a['min'] for a in positions], axis=0).tolist(), 'max': np.max([a['max'] for a in positions], axis=0).tolist()}))
