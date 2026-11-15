"""Byte-parity against the captured office recipe, using synthetic photos only."""
import hashlib
import importlib
import json
from io import BytesIO
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import cv2
from PIL import Image, ImageDraw
from renderer import render


class RendererTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        cls.root=Path(cls.temp.name)
        sys.path.insert(0,str(Path(__file__).parent/'office_recipe'))
        with patch.object(Path,'home',return_value=cls.root):
            cls.natural=importlib.import_module('photo_finish')
            cls.style=importlib.import_module('background_finish_v4')
            cls.square=importlib.import_module('facebook_square_v2')
            cls.pop=importlib.import_module('photo_pop')
        cls.natural.ORIGINALS.mkdir(parents=True)
        im=Image.new('RGB',(480,640),(145,149,152))
        d=ImageDraw.Draw(im)
        for y in range(640):d.line((0,y,479,y),fill=(120+y//12,125+y//13,130+y//14))
        d.ellipse((100,520,400,580),fill=(90,92,94))
        d.rounded_rectangle((110,70,370,540),radius=18,fill=(218,210,193),outline=(35,40,45),width=8)
        d.rectangle((140,110,340,220),fill=(40,60,80))
        d.line((360,430,430,600),fill=(24,25,26),width=6)
        out=BytesIO();im.save(out,'JPEG',quality=95)
        cls.payload=out.getvalue();cls.sha=hashlib.sha256(cls.payload).hexdigest()
        cls.original=cls.natural.ORIGINALS/(cls.sha+'.jpg')
        cls.original.write_bytes(cls.payload)

    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()

    def office(self,style='natural',pop=False,kind='real',focus=None):
        cv2.setNumThreads(1);cv2.setRNGSeed(0)
        if kind=='real':
            payload,_=self.natural.finish_bytes(self.original,self.sha)
            source=self.natural.output_path(self.sha);source.write_bytes(payload)
            if style!='natural':
                # Remove only synthetic cached style files between cases.
                for mode in ('blur','brand'):self.style.target(self.sha,mode).unlink(missing_ok=True)
                self.style.meta_path(self.sha).unlink(missing_ok=True)
                self.style.process(self.sha,source)
                source=self.style.path_for(self.sha,style) or source
        else:source=self.original
        rules={self.sha:{'review_status':'system_visual_checked',
                        'approved_for':'square_cover_composition_only','crop_box_frac':focus}} if focus else {}
        self.square.RULES.parent.mkdir(parents=True,exist_ok=True)
        self.square.RULES.write_text(json.dumps({'rules':rules}))
        image,_=self.square.render(source)
        result=BytesIO();image.save(result,'JPEG',quality=91,subsampling=0,optimize=True)
        if pop:
            square=self.square.DEST/'synthetic.jpg';square.write_bytes(result.getvalue())
            target,_=self.pop.ensure(square)
            return target.read_bytes()
        return result.getvalue()

    def test_office_recipe_parity(self):
        for options in [dict(),dict(pop=True),dict(style='blur'),dict(style='brand'),
                        dict(kind='manufacturer'),dict(focus=[.06,0,.94,1])]:
            with self.subTest(options=options):
                expected=self.office(**options)
                actual,info=render(self.payload,self.sha,**options,focus_reviewed=True)
                self.assertEqual(hashlib.sha256(actual).hexdigest(),hashlib.sha256(expected).hexdigest())
                with Image.open(BytesIO(actual)) as image:
                    self.assertEqual(image.size,(1600,1600));self.assertEqual(image.format,'JPEG')
                self.assertEqual(info['bytes'],len(actual))
                self.assertEqual(self.original.read_bytes(),self.payload)

    def test_repeat_is_deterministic(self):
        a,meta=render(self.payload,self.sha,style='blur',pop=True)
        b,meta2=render(self.payload,self.sha,style='blur',pop=True)
        self.assertEqual(a,b);self.assertEqual(meta,meta2)

    def test_source_and_policy_guards(self):
        cases=[dict(expected_sha='0'*64),dict(kind='private_label'),dict(style='invalid'),
               dict(kind='manufacturer',pop=True),dict(kind='manufacturer',style='brand'),
               dict(focus=[.1,0,.9,1]),dict(focus=[.3,0,.7,1],focus_reviewed=True)]
        for changes in cases:
            with self.subTest(changes=changes):
                options={'expected_sha':self.sha,**changes}
                with self.assertRaises(ValueError):render(self.payload,**options)
        tiny=BytesIO();Image.new('RGB',(50,50)).save(tiny,'JPEG');data=tiny.getvalue()
        with self.assertRaises(ValueError):render(data,hashlib.sha256(data).hexdigest())


if __name__=='__main__':unittest.main()
