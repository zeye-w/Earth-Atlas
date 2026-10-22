"""Deterministic, metre-scale schematic of the Tiangong T configuration.

Only stdlib + numpy. glTF +Z forward, +Y zenith, +X cross-track.
Not an engineering replica or a claim about the current visiting spacecraft.
Usage: python3 video/cinematic/tiangong_model.py out.glb
"""
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np


class Geometry:
    def __init__(self):
        self.groups = {i: ([], []) for i in range(3)}

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
        c, h = np.array(center), np.array(size) / 2
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

    def cylinder(self, start, end, radius, material=0):
        a, b = np.array(start, float), np.array(end, float)
        axis = b - a
        axis /= np.linalg.norm(axis)
        helper = np.eye(3)[np.argmin(np.abs(axis))]
        u = np.cross(axis, helper)
        u /= np.linalg.norm(u)
        v = np.cross(axis, u)
        for i in range(24):
            normals = [math.cos(k * 2 * math.pi / 24) * u + math.sin(k * 2 * math.pi / 24) * v for k in [i, i + 1]]
            p, q = normals
            self.triangle(material, [a + radius*p, b + radius*p, b + radius*q], [p, p, q])
            self.triangle(material, [a + radius*p, b + radius*q, a + radius*q], [p, q, q])
            self.triangle(material, [a, a + radius*p, a + radius*q], [-axis] * 3)
            self.triangle(material, [b, b + radius*p, b + radius*q], [axis] * 3)

    def sphere(self, center, radius, material=0):
        c = np.array(center)
        def normal(i, j):
            phi, theta = -math.pi/2 + i*math.pi/16, j*math.pi/12
            return np.array([math.cos(phi)*math.cos(theta), math.sin(phi), math.cos(phi)*math.sin(theta)])
        for i in range(16):
            for j in range(24):
                normals = [normal(i,j), normal(i+1,j), normal(i+1,j+1), normal(i,j+1)]
                for indices in [(0,1,2),(0,2,3)]:
                    ns = [normals[k] for k in indices]
                    self.triangle(material, [c+radius*n for n in ns], ns)

    def wing(self, center, size):
        self.box(center, size, 1)
        # Gold perimeter, flush with the panel rather than detached parts.
        c, s = np.array(center), np.array(size)
        for axis in [0, 2]:
            other = 2 if axis == 0 else 0
            for sign in [-1, 1]:
                p = c.copy()
                p[other] += sign*(s[other]/2 - .035)
                extent = s.copy()
                extent[other] = .07
                extent[1] = .07
                self.box(p, extent, 2)


def make_model():
    g = Geometry()
    # Tianhe: rear -Z to front +Z, 16.6 m overall.
    g.cylinder([0,0,-8.3], [0,0,-2.3], 1.4)
    g.cylinder([0,0,-2.3], [0,0,6.7], 2.1)
    g.cylinder([0,0,6.7], [0,0,8.3], 1.4)
    # T node and two 17.9 m experiment modules; 38.6 m across.
    g.sphere([0,0,9.7], 1.4)
    for sign in [-1,1]:
        g.cylinder([sign*1.4,0,9.7], [sign*19.3,0,9.7], 2.1)
        # A connected yoke roots the +/-Z arrays at the outer module end.
        x = sign*18.8
        g.box([x,0,0], [.22,.22,24], 2)
        for direction in [-1,1]:
            g.wing([x,0,direction*13.0], [3.2,.05,26.0])
        # Core rear arrays, connected directly to Tianhe.
        g.wing([sign*6.4,0,-5.3], [10,.05,2.5])
    # Tianzhou aft, schematic docking collar and cargo cylinder.
    g.cylinder([0,0,-8.3], [0,0,-9.0], .65, 2)
    g.cylinder([0,0,-8.3], [0,0,-18.9], 1.675)
    # Shenzhou docked nadir (-Y) at the forward node.
    g.cylinder([0,-1.4,9.7], [0,-10.4,9.7], 1.4)
    return g


def write_glb(path):
    geometry = make_model()
    binary = bytearray()
    views, accessors, primitives = [], [], []
    for material, (positions, normals) in geometry.groups.items():
        attributes = {}
        for semantic, values in [('POSITION',positions), ('NORMAL',normals)]:
            array = np.array(values, dtype='<f4')
            offset = len(binary)
            binary.extend(array.tobytes())
            views.append({'buffer':0, 'byteOffset':offset, 'byteLength':array.nbytes, 'target':34962})
            accessor = {'bufferView':len(views)-1,'componentType':5126,'count':len(array),'type':'VEC3'}
            if semantic == 'POSITION':
                accessor.update(min=array.min(axis=0).tolist(), max=array.max(axis=0).tolist())
            accessors.append(accessor)
            attributes[semantic] = len(accessors)-1
        primitives.append({'attributes':attributes,'material':material,'mode':4})
    document = {
        'asset':{'version':'2.0','generator':'Earth-Atlas procedural station schematic'},
        'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0,'name':'Tiangong schematic, metres'}],
        'meshes':[{'primitives':primitives}], 'buffers':[{'byteLength':len(binary)}],
        'bufferViews':views,'accessors':accessors,
        'materials':[
            {'name':'module','pbrMetallicRoughness':{'baseColorFactor':[.85,.85,.82,1],'metallicFactor':0,'roughnessFactor':.6}},
            {'name':'solar array','doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':[.06,.08,.18,1],'metallicFactor':.3,'roughnessFactor':.35}},
            {'name':'gold frame','pbrMetallicRoughness':{'baseColorFactor':[.75,.6,.3,1],'metallicFactor':.4,'roughnessFactor':.5}},
        ],
        'extras':{'units':'metres','schematic':True,'axes':'+Z forward, +Y zenith, +X cross-track'},
    }
    encoded = json.dumps(document,separators=(',',':'),ensure_ascii=True).encode()
    encoded += b' ' * (-len(encoded) % 4)
    binary += b'\0' * (-len(binary) % 4)
    output = struct.pack('<4sII',b'glTF',2,12+8+len(encoded)+8+len(binary))
    output += struct.pack('<I4s',len(encoded),b'JSON')+encoded
    output += struct.pack('<I4s',len(binary),b'BIN\0')+binary
    path = Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(output)
    return document


if __name__ == '__main__':
    document = write_glb(sys.argv[1])
    positions = [a for a in document['accessors'] if 'min' in a]
    print(json.dumps({'file':sys.argv[1], 'min':np.min([a['min'] for a in positions],axis=0).tolist(), 'max':np.max([a['max'] for a in positions],axis=0).tolist()}))
