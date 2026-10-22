"""Independently validate generated station GLB geometry and bounds."""
import hashlib
import json
import struct
import sys
from pathlib import Path
import numpy as np


def check(path):
    raw = Path(path).read_bytes()
    magic, version, length = struct.unpack_from('<4sII', raw)
    assert (magic,version,length) == (b'glTF',2,len(raw))
    json_length, kind = struct.unpack_from('<I4s',raw,12)
    assert kind == b'JSON'
    doc = json.loads(raw[20:20+json_length])
    bin_length, kind = struct.unpack_from('<I4s',raw,20+json_length)
    assert kind == b'BIN\0'
    binary = raw[28+json_length:]
    assert len(binary) == bin_length
    def accessor(index):
        a = doc['accessors'][index]
        v = doc['bufferViews'][a['bufferView']]
        assert a['componentType'] == 5126 and a['type'] == 'VEC3'
        offset = v.get('byteOffset',0)+a.get('byteOffset',0)
        values = np.frombuffer(binary,dtype='<f4',count=a['count']*3,offset=offset).reshape(-1,3)
        assert np.isfinite(values).all()
        if 'min' in a:
            np.testing.assert_allclose(values.min(axis=0),a['min'],atol=1e-6)
            np.testing.assert_allclose(values.max(axis=0),a['max'],atol=1e-6)
        return values
    positions = []
    triangles = 0
    for primitive in doc['meshes'][0]['primitives']:
        p = accessor(primitive['attributes']['POSITION'])
        n = accessor(primitive['attributes']['NORMAL'])
        assert len(p) == len(n) and len(p)%3 == 0
        np.testing.assert_allclose(np.linalg.norm(n,axis=1),1,atol=1e-6)
        t = p.reshape(-1,3,3)
        face = np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0])
        assert (np.linalg.norm(face,axis=1)>1e-8).all()
        assert (np.sum(face*n.reshape(-1,3,3).mean(axis=1),axis=1)>0).all()
        positions.append(p)
        triangles += len(t)
    p = np.concatenate(positions)
    low, high = p.min(axis=0),p.max(axis=0)
    np.testing.assert_allclose(low,[-20.4,-10.4,-26],atol=.1)
    np.testing.assert_allclose(high,[20.4,2.1,26],atol=.1)
    assert len(doc['materials']) == 3 and doc['materials'][1]['doubleSided']
    print(json.dumps({'sha256':hashlib.sha256(raw).hexdigest(),'triangles':triangles,'min':low.tolist(),'max':high.tolist()}))


if __name__ == '__main__':
    check(sys.argv[1])
