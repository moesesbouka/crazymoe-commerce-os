"""Guarded NGK 68.1.23 -> 68.1.24 approved-picker upgrade; leaves gallery/photo queue code intact."""
from pathlib import Path
import hashlib,json,subprocess,sys
EXPECTED={'approved_batch_panel.js':'d9fd7a489da8c141ab26b3c10cb8d4d969de2eaa9ea255257e1fe60045722c54','ngk_cloud_worker.js':'28e43785c7bb833b15541a9d2f8be478f930106a595753713cbd4ec1bd743038','popup.js':'5725ae82701692d862fa9ea8d756bb8b3f08a3654498bb241165678394a940aa','popup.html':'20b08d72b60122f357e23e1e4e05305aa3eaf61a0102c197d6a8733b85381a05','manifest.json':'3d0922410e5efb814f519e388ecc89c3c85b8c1286e213d7e34020d5d0fcc132'}
def main(target,source):
 target=Path(target);source=Path(source);originals={n:(target/n).read_bytes() for n in EXPECTED}
 for name,data in originals.items():
  if hashlib.sha256(data).hexdigest()!=EXPECTED[name]:raise SystemExit('Concurrent extension change; inspect before installation: '+name)
 manifest=json.loads(originals['manifest.json'])
 if manifest['version']!='68.1.23':raise SystemExit('Unexpected installed version')
 manifest['version']='68.1.24'
 changes={name:(source/name).read_bytes() for name in ('approved_batch_panel.js','approved_picker_worker.js','ngk_cloud_worker.js','popup.js','popup.html')}
 changes['manifest.json']=(json.dumps(manifest,indent=2)+'\n').encode()
 for name in changes:
  if name.endswith('.js'):subprocess.run(['node','--check',str(source/name)],check=True)
 backup=target.parent/'pre-approved-picker-68.1.23';backup.mkdir(exist_ok=True)
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
