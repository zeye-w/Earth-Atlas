"""Recenter and normalize verified glTF assets, preserving spacecraft geometry.
Usage: python scripts/prepare-satellite-models.py SOURCE_DIRECTORY
NASA Terra references unavailable TGA files; retain material colors without those textures.
"""
import json,struct,sys,itertools,hashlib
from pathlib import Path
import numpy as np
source=Path(sys.argv[1]);out=Path('public/models/satellites');out.mkdir(parents=True,exist_ok=True)
records=[]
for name in ['iss','hubble','terra','tiangong']:
 raw=(source/(name+'.glb')).read_bytes();size=struct.unpack_from('<I',raw,12)[0]
 doc=json.loads(raw[20:20+size]);binary=raw[28+size:]
 nodes=doc['nodes'];roots=doc['scenes'][doc.get('scene',0)]['nodes'];points=[]
 def matrix(node):
  if 'matrix' in node:return np.array(node['matrix']).reshape((4,4),order='F')
  x,y,z,w=node.get('rotation',[0,0,0,1]);r=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
  m=np.eye(4);m[:3,:3]=r@np.diag(node.get('scale',[1,1,1]));m[:3,3]=node.get('translation',[0,0,0]);return m
 def visit(i,parent):
  n=nodes[i];m=parent@matrix(n)
  if 'mesh' in n:
   for prim in doc['meshes'][n['mesh']]['primitives']:
    a=doc['accessors'][prim['attributes']['POSITION']]
    for xyz in itertools.product(*zip(a['min'],a['max'])):points.append((m@np.array([*xyz,1]))[:3])
  for c in n.get('children',[]):visit(c,m)
 for root in roots:visit(root,np.eye(4))
 lo=np.min(points,axis=0);hi=np.max(points,axis=0);span=float(max(hi-lo));center=(lo+hi)/2
 assert span>0 and np.isfinite(span)
 wrapper=np.eye(4);wrapper[:3,:3]/=span;wrapper[:3,3]=-center/span
 nodes.append({'name':'Earth Atlas normalized display frame','children':roots,'matrix':wrapper.flatten(order='F').tolist()});doc['scenes'][doc.get('scene',0)]['nodes']=[len(nodes)-1]
 if name=='terra':
  def clean(value):
   if isinstance(value,dict):
    for k in list(value):
     if k.endswith('Texture'):del value[k]
     else:clean(value[k])
   elif isinstance(value,list):
    for item in value:clean(item)
  clean(doc.get('materials',[]));doc.pop('images',None);doc.pop('textures',None);doc.pop('samplers',None)
 assert all('uri' not in b for b in doc.get('buffers',[]))
 assert all('uri' not in i for i in doc.get('images',[]))
 encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
 body=struct.pack('<I4s',len(encoded),b'JSON')+encoded+struct.pack('<I4s',len(binary),b'BIN\x00')+binary
 result=struct.pack('<4sII',b'glTF',2,12+len(body))+body;(out/(name+'.glb')).write_bytes(result)
 records.append({'id':name,'originalSha256':hashlib.sha256(raw).hexdigest(),'sha256':hashlib.sha256(result).hexdigest(),'bytes':len(result),'normalization':{'center':center.tolist(),'longestDimension':span},'materials':'original colors; missing external textures removed' if name=='terra' else 'original'})
(out/'manifest.json').write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps(records,indent=2))
