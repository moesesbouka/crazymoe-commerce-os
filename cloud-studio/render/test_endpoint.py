import importlib.util
from io import BytesIO
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('render_endpoint',Path(__file__).parent/'api/render.py')
endpoint=importlib.util.module_from_spec(spec);spec.loader.exec_module(endpoint)

class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.body={'id':'synthetic','revision':2,'photo_revision':3,'index':0}
        self.item={'id':'synthetic','revision':2,'lifecycle':'current','exports_verified':False,
                   'photo_selection':[{'kind':'real','sha':'a'*64}]}
        self.calls=0;self.stale=False
    def cloud(self,path,auth,body=None):
        if path.endswith('/inventory'):return {'items':[self.item]}
        if path.endswith('studio_photo_choices'):
            self.calls+=1
            return {'revision':4 if self.stale and self.calls==2 else 3,'listing_revision':2}
        return {'url':endpoint.ROOT+'/storage/v1/object/sign/studio-originals/test','sha256':'a'*64}
    def response(self):
        data=BytesIO(b'source');data.url=endpoint.ROOT+'/storage/v1/object/sign/studio-originals/test'
        return data
    def test_selected_source_preview(self):
        with patch.object(endpoint,'cloud',self.cloud),patch.object(endpoint,'urlopen',return_value=self.response()),patch.object(endpoint,'render',return_value=(b'jpeg',{})) as renderer:
            image,receipt=endpoint.prepare(self.body,'Bearer fixture')
            self.assertEqual(image,b'jpeg');self.assertEqual(receipt['photo_revision'],3)
            self.assertEqual(self.calls,2);renderer.assert_called_once()
    def test_revision_changes_during_render(self):
        self.stale=True
        with patch.object(endpoint,'cloud',self.cloud),patch.object(endpoint,'urlopen',return_value=self.response()),patch.object(endpoint,'render',return_value=(b'jpeg',{})):
            with self.assertRaises(endpoint.Rejected) as raised:endpoint.prepare(self.body,'Bearer fixture')
            self.assertEqual(raised.exception.status,409)
    def test_existing_exports_untouched(self):
        self.item['exports_verified']=True
        with patch.object(endpoint,'cloud',self.cloud),patch.object(endpoint,'render') as renderer:
            with self.assertRaises(endpoint.Rejected):endpoint.prepare(self.body,'Bearer fixture')
            renderer.assert_not_called()
    def test_no_auth_or_arbitrary_url(self):
        with self.assertRaises(endpoint.Rejected):endpoint.prepare(self.body,'')
        with self.assertRaises(endpoint.Rejected):endpoint.prepare({**self.body,'url':'https://example.test'},'Bearer fixture')

if __name__=='__main__':unittest.main()
