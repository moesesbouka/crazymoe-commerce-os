"""Install the tested reconnect fix over the inspected NGK 68.1.25 extension."""
import hashlib,json,subprocess,sys
from pathlib import Path
EXPECTED={'manifest.json':'73beae38283704f3e7a9f0e614311f3e2019a118451767be4cc214b47cf0c632','cloud_handoff.js':'c70bb3015573d45756a3dbe5709150682a8924dde4aa1ded8940137cf385ae5a','approved_batch_panel.js':'9e015d109bcb80a78a85d373778cecbbdb3a1ab2d890052996789e9252d08a72'}
def install(target,source):
 original={name:(target/name).read_bytes() for name in EXPECTED}
 assert all(hashlib.sha256(data).hexdigest()==EXPECTED[name] for name,data in original.items()),'Extension changed; inspect before installing'
 manifest=json.loads(original['manifest.json']);assert manifest['version']=='68.1.25'
 manifest['version']='68.1.26'
 manifest['content_scripts'].append({'matches':['https://crazymoe-marketplace-studio.vercel.app/*','https://studio.crazymoe.com/*'],'js':['studio_connection_bridge.js'],'run_at':'document_idle'})
 changes={name:(source/name).read_bytes() for name in ('cloud_handoff.js','approved_batch_panel.js','studio_connection_bridge.js')}
 changes['manifest.json']=(json.dumps(manifest,indent=2)+'\n').encode()
 for name in changes:
  if name.endswith('.js'):subprocess.run(['node','--check',str(source/name)],check=True)
 backup=target.parent/'pre-reconnect-68.1.26';backup.mkdir(exist_ok=False)
 for name,data in original.items():(backup/name).write_bytes(data)
 written=[]
 try:
  for name,data in changes.items():
   path=target/name
   if name in original:assert path.read_bytes()==original[name],'Concurrent extension edit'
   else:assert not path.exists(),'Unexpected bridge file'
   temp=path.with_suffix(path.suffix+'.reconnect.tmp');temp.write_bytes(data);temp.replace(path);written.append(name)
  assert all((target/name).read_bytes()==data for name,data in changes.items())
 except BaseException:
  for name in reversed(written):
   if (target/name).read_bytes()==changes[name]:
    if name in original:(target/name).write_bytes(original[name])
    else:(target/name).unlink()
  raise
 print(json.dumps({'installed_version':'68.1.26','files_verified':len(changes),'chrome_reload_required':True}))
if __name__=='__main__':install(Path(sys.argv[1]),Path(__file__).parent)
