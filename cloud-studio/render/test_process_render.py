import importlib.util
from io import BytesIO
from pathlib import Path
import hashlib
import unittest
from unittest.mock import Mock,patch
from PIL import Image
spec=importlib.util.spec_from_file_location('machine',Path(__file__).parent/'api/process_render.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class WorkerTests(unittest.TestCase):
 def setUp(self):
  b=BytesIO();Image.new('RGB',(1600,1600),(80,100,120)).save(b,'JPEG');self.data=b.getvalue()
  self.secret='a'*64
  self.body={'url':'https://'+m.HOST+'/storage/v1/object/sign/studio-originals/originals/test?token=fixture','sha256':hashlib.sha256(self.data).hexdigest(),'bytes':len(self.data),'style':'natural','pop':False}
 def run_process(self,body=None,auth=None,source=None):
  opener=Mock();opener.open.return_value=BytesIO(self.data if source is None else source)
  return m.process(body or self.body,auth or 'Bearer '+self.secret,secret=self.secret,opener=opener)
 def test_auth_before_network(self):
  with patch.object(m,'build_opener') as network:
   with self.assertRaises(PermissionError):m.process(self.body,'Bearer wrong',secret=self.secret)
   with self.assertRaises(PermissionError):m.process(self.body,'Bearer ',secret='')
   network.assert_not_called()
 def test_valid_jpeg(self):
  data,receipt=self.run_process()
  self.assertEqual(receipt['sha256'],hashlib.sha256(data).hexdigest())
  with Image.open(BytesIO(data)) as im:self.assertEqual(im.size,(1600,1600))
 def test_source_integrity(self):
  for source in [self.data+b'x',self.data[:-1],b'x'*len(self.data)]:
   with self.assertRaises(ValueError):self.run_process(source=source)
 def test_ssrf_and_options(self):
  for delta in [{'url':'http://127.0.0.1/private'},{'url':'https://'+m.HOST+'.evil.test/storage/v1/object/sign/studio-originals/a'},{'url':'https://'+m.HOST+'/auth/v1/admin'},{'bytes':True},{'style':'invalid'},{'pop':'false'}]:
   with self.assertRaises(ValueError):self.run_process({**self.body,**delta})
 def test_no_redirects(self):
  with self.assertRaises(ValueError):m.NoRedirect().redirect_request(None,None,None,None,None,None)
if __name__=='__main__':unittest.main()
