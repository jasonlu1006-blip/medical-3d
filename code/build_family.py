"""Add source-linked family explanations without altering original image bytes."""
import argparse, hashlib, json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--source-dir',type=Path,required=True);p.add_argument('--content',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True);a=p.parse_args()
a.output_dir.mkdir(parents=True,exist_ok=True)
manifest={'schema':'family-guide-build-v1','content_sha256':hashlib.sha256(a.content.read_bytes()).hexdigest(),'packages':[]}
for item in json.loads(a.content.read_text())['studies']:
 name=item['file']; assert Path(name).name==name and name.endswith('.m3d')
 source=a.source_dir/name;raw=source.read_bytes();data=json.loads(raw);g=item['guide']
 assert g['schema']=='family-guide-v1' and len(g['steps'])==4
 assert 0<=g['frame']<len(data['framesBase64'])
 assert len(g['roi'])==4 and all(isinstance(x,int) and 0<=x<=768 for x in g['roi'])
 assert g['roi'][0]+g['roi'][2]<=768 and g['roi'][1]+g['roi'][3]<=768
 original=data['framesBase64'].copy();data['familyGuide']=g
 target=a.output_dir/name
 with target.open('x') as f:json.dump(data,f,ensure_ascii=False,separators=(',',':'))
 reread=json.loads(target.read_text());assert reread['framesBase64']==original
 manifest['packages'].append({'file':name,'source_sha256':hashlib.sha256(raw).hexdigest(),'output_sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'frames_preserved':len(original),'frame_index':g['frame'],'roi_kind':'reading-locator-not-segmentation','sources':g['sources']})
(a.output_dir/'build-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps({'packages':len(manifest['packages']),'source_frames_unchanged':True}))
