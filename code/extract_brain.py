"""Bounded, offline SynthStrip candidate extraction from a display stack.

This is an experimental JPEG input adapter, not native DICOM reconstruction.
Source pixels are preserved. Assumed display geometry is explicitly recorded.
Run through FORGE safe_run; output goes only to that job's out directory.
"""
import argparse, ast, base64, hashlib, io, json, os, sys, time
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('--input',type=Path,required=True)
p.add_argument('--model',type=Path,required=True)
p.add_argument('--upstream',type=Path,required=True)
p.add_argument('--extra-packages',type=Path,required=True)
p.add_argument('--resume',type=Path,help='Verified previous inference out directory; reuse only signed distances')
a=p.parse_args()
sys.path.insert(0,str(a.extra_packages))
import numpy as np
from scipy import ndimage
from PIL import Image, ImageDraw
import torch
import torch.nn as nn
from skimage.measure import marching_cubes

started=time.monotonic();torch.set_num_threads(4)
out=Path(os.environ['FORGE_SAFE_RUN_JOB'])/'out';out.mkdir(exist_ok=True)
raw=a.input.read_bytes()
if len(raw)>16*1024**2:raise ValueError('Input exceeds budget')
package=json.loads(raw)
if package['format']!='medical-3d-display-stack-v1' or len(package['framesBase64'])>128:raise ValueError('Input format/budget')
frames=[]
for encoded in package['framesBase64']:
 im=Image.open(io.BytesIO(base64.b64decode(encoded)))
 if max(im.size)>2048:raise ValueError('Frame too large')
 frames.append(np.asarray(im.convert('L').resize((256,256),Image.Resampling.BILINEAR)))
volume=np.stack(frames) # z, raster y, x; no source pixel changes in saved package.

# The existing preview uses z:x display ratio 4:1. This is NOT millimetres.
# Map the presumed axial display stack to the model's LIA-like array convention.
# Direction/spacing are assumptions, not recovered patient geometry.
oriented=np.transpose(volume,(2,0,1))[:,:,::-1].copy()
shape=np.array(oriented.shape);target=np.array([192,round(shape[1]*3),192])
if np.any(target>256):raise ValueError('Model input exceeds budget')
resized=ndimage.zoom(oriented.astype(np.float32),target/shape,order=1)
resized-=resized.min();resized/=max(float(np.percentile(resized,99)),1)
resized=np.clip(resized,0,1)
padshape=np.ceil(target/64).astype(int)*64
padding=[((int(b)-int(s))//2,(int(b)-int(s)+1)//2) for s,b in zip(resized.shape,padshape)]
inp=np.pad(resized,padding)

# Only reviewed class definitions from a pinned upstream file are compiled.
tree=ast.parse(a.upstream.read_text());main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
classes=[n for n in main.body if isinstance(n,ast.ClassDef) and n.name in ('StripModel','ConvBlock')]
if len(classes)!=2:raise ValueError('Upstream architecture changed')
scope={'torch':torch,'nn':nn,'np':np}
exec(compile(ast.Module(body=classes,type_ignores=[]),str(a.upstream),'exec'),scope)
expected='37417f802196186441aae3e7f385d94f8a98c64a88acaeaa2723af995c653e33'
if hashlib.sha256(a.model.read_bytes()).hexdigest()!=expected:raise ValueError('Model integrity mismatch')
if a.resume:
 proof=json.loads((a.resume/'provenance.json').read_text());prior=a.resume/'segmentation-review.npz'
 if proof['source_sha256']!=hashlib.sha256(raw).hexdigest() or proof['model_sha256']!=expected or prior.stat().st_size>64*1024**2 or hashlib.sha256(prior.read_bytes()).hexdigest()!=proof['outputs'][prior.name]:raise ValueError('Inference reuse integrity mismatch')
 native=np.load(prior,allow_pickle=False)['distance']
 if native.shape!=volume.shape or not np.isfinite(native).all():raise ValueError('Invalid reused distance field')
else:
 model=scope['StripModel']();checkpoint=torch.load(a.model,map_location='cpu',weights_only=True)
 model.load_state_dict(checkpoint['model_state_dict']);model.eval()
 print(json.dumps({'stage':'inference','shape':list(inp.shape),'threads':4}),flush=True)
 with torch.inference_mode():distance=model(torch.from_numpy(inp[None,None])).squeeze().numpy()
 distance=distance[tuple(slice(lo,lo+int(n)) for (lo,hi),n in zip(padding,target))]
 distance=ndimage.zoom(distance,shape/target,order=1)
 native=np.transpose(distance[:,:,::-1],(1,2,0))
mask=native<1  # upstream default border, in assumed inference/display geometry
labels,count=ndimage.label(mask);sizes=np.bincount(labels.ravel());sizes[0]=0
if count==0:raise ValueError('Empty extraction')
mask=ndimage.binary_fill_holes(labels==int(sizes.argmax()))
ratio=float(mask.mean())
if not .015<ratio<.6:raise ValueError('Implausible extraction size')

# Browser flips raster Y. Mask and mesh use the identical display lattice.
display_mask=mask[:,::-1,:].copy()
flat=display_mask.ravel().astype(np.uint8)
changes=np.flatnonzero(np.diff(flat))+1
counts=np.diff(np.r_[0,changes,flat.size]).astype('<u4')
mask_info={'encoding':'rle-u32le-base64','first':int(flat[0]),'runs':base64.b64encode(counts.tobytes()).decode(),'voxels':int(flat.size)}
# Mesh retains the same arbitrary display proportions as the viewer.
surface=ndimage.zoom(display_mask.astype(np.float32),(2,1,1),order=1)
surface=ndimage.gaussian_filter(surface,.65) # surface rendering only; original mask unchanged
vertices,faces,_,_=marching_cubes(surface,.5,spacing=(2,1,1),step_size=2,allow_degenerate=False)
vertices=vertices[:,[2,1,0]] # x,y,z in display coordinates
if len(faces)>160000:raise ValueError('Mesh exceeds mobile budget')
# Marching cubes descent uses left-handed faces. Swapping z,x yields OBJ outward winding.
obj='\n'.join(['# Candidate brain surface; display units only']+['v %.3f %.3f %.3f'%tuple(v) for v in vertices]+['f %d %d %d'%tuple(f+1) for f in faces])+'\n'
(out/'brain-candidate.obj').write_text(obj)
package['brainExtraction']={'format':'brain-candidate-v1','candidate':True,'method':'SynthStrip v1; experimental display-JPEG adapter','geometryVerified':False,'segmentationClinicallyReviewed':False,'mask':mask_info,'meshOBJ':obj,'surfaceVertices':len(vertices),'surfaceFaces':len(faces),'assumedDisplaySpacing':[1,1,4]}
(out/'brain-candidate.m3d').write_text(json.dumps(package,ensure_ascii=False,separators=(',',':')))
np.savez_compressed(out/'segmentation-review.npz',volume=volume,mask=mask,distance=native)
# Every source slice is represented in the visual mask review, green overlay.
cols=7;cell=160;rows=(len(mask)+cols-1)//cols
sheet=Image.new('RGB',(cols*cell,rows*(cell+20)),(18,24,27));draw=ImageDraw.Draw(sheet)
for z in range(len(mask)):
 gray=volume[z];rgb=np.repeat(gray[:,:,None],3,axis=2).astype(np.float32)
 rgb[mask[z]]=rgb[mask[z]]*.65+np.array([40,220,135])*.35
 im=Image.fromarray(np.uint8(rgb)).resize((cell,cell));x=(z%cols)*cell;y=(z//cols)*(cell+20)
 sheet.paste(im,(x,y));draw.text((x+5,y+cell+2),f'{z+1}/{len(mask)}  mask {mask[z].sum()}',fill='white')
sheet.save(out/'mask-review-all-slices.png')
proof={'source_sha256':hashlib.sha256(raw).hexdigest(),'model_sha256':expected,'upstream_sha256':hashlib.sha256(a.upstream.read_bytes()).hexdigest(),'source_dimensions':list(volume.shape),'inference_shape':list(inp.shape),'assumptions':['display spacing 1:1:4, no physical units','presumed axial slice orientation; not DICOM-verified','JPEG grayscale and spatial resampling differ from native MRI'],'inference_reused_from':str(a.resume) if a.resume else None,'mask_border':1,'surface_smoothing':'Z interpolation 2x; Gaussian sigma .65 for mesh only','mask_fraction':ratio,'surface_vertices':len(vertices),'surface_faces':len(faces),'segmentation_clinically_reviewed':False,'source_geometry_verified':False,'runtime_seconds':time.monotonic()-started,'outputs':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in out.iterdir() if f.is_file()}}
(out/'provenance.json').write_text(json.dumps(proof,indent=2));print(json.dumps({k:v for k,v in proof.items() if k not in ('outputs','assumptions')}),flush=True)
