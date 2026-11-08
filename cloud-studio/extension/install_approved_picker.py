"""Guarded NGK 68.1.24 -> 68.1.25 posting-loop upgrade; leaves gallery/photo queue code intact."""
from pathlib import Path
import hashlib,json,subprocess,sys
EXPECTED={'approved_batch_panel.js':'dde8171d226d7509cb13d64174cf03da208ef38e3dc062406109dc912fdf5397','approved_picker_worker.js':'9b8fa08c7e3f3ce68919b88364e47a69dd455f44e851c3e80b94dc3ab50df3e4','ngk_cloud_worker.js':'d9d56522e373d16a59327e978f42710686bd9a2eca10c601c53df6cb43ae6340','manifest.json':'08d21e0ef987505841dc2370f29912f86535447c274e74360ed7d2623d880c9a'}
def main(target,source):
 target=Path(target);source=Path(source);originals={n:(target/n).read_bytes() for n in EXPECTED}
 for name,data in originals.items():
  if hashlib.sha256(data).hexdigest()!=EXPECTED[name]:raise SystemExit('Concurrent extension change; inspect before installation: '+name)
 manifest=json.loads(originals['manifest.json'])
 if manifest['version']!='68.1.24':raise SystemExit('Unexpected installed version')
 manifest['version']='68.1.25'
 for entry in manifest['content_scripts']:
  if 'approved_batch_panel.js' in entry.get('js',[]):entry['matches']=['https://www.facebook.com/marketplace/*','https://m.facebook.com/marketplace/*']
 changes={name:(source/name).read_bytes() for name in ('approved_batch_panel.js','approved_picker_worker.js','ngk_cloud_worker.js')}
 changes['manifest.json']=(json.dumps(manifest,indent=2)+'\n').encode()
 for name in changes:
  if name.endswith('.js'):subprocess.run(['node','--check',str(source/name)],check=True)
 backup=target.parent/'pre-posting-loop-68.1.24';backup.mkdir(exist_ok=True)
 for name,data in originals.items():
  path=backup/name
  if path.exists() and path.read_bytes()!=data:raise SystemExit('Backup conflict')
  path.write_bytes(data)
 written=[]
 try:
  for name,data in changes.items():
   path=target/name
   if name in originals and path.read_bytes()!=originals[name]:raise RuntimeError('Concurrent extension change')
   if name not in originals and path.exists():raise RuntimeError('New module already exists')
   path.write_bytes(data);written.append(name)
 except BaseException:
  for name in reversed(written):
   if (target/name).read_bytes()==changes[name]:
    if name in originals:(target/name).write_bytes(originals[name])
    else:(target/name).unlink()
  raise
 print(json.dumps({'version':manifest['version'],'installed_on_disk':True,'reload_required':True,'files':{name:hashlib.sha256(data).hexdigest() for name,data in changes.items()}}))
if __name__=='__main__':main(*sys.argv[1:])
