import unittest
from clean import clean
class CopyPolicyTests(unittest.TestCase):
 def test_screenshot(self):
  text='Lasko CW105 heater.\nMODEL FEATURES: 1500 W; timer.\nACTUAL WAREHOUSE UNIT: visibly worn box; remote NOT confirmed. Cosmetic condition untested.'
  self.assertEqual(clean(text),'Lasko CW105 heater.\nMODEL FEATURES: 1500 W; timer.')
 def test_product_fact_preservation(self):
  for text in ['Roon Tested and separate subwoofer output','Uses an internally damped platter.','Requires Philips Hue Bridge.','1500 W heater.\n\nTimer: 8 hours.\n']:
   self.assertEqual(clean(text),text)
  self.assertEqual(clean('1000 W amplifier (peak; not measured on this item)'),'1000 W amplifier (peak)')
 def test_titles(self):
  self.assertEqual(clean('Safe - Lock Untested','title'),'Safe')
  self.assertEqual(clean('Video processor - Untested','title'),'Video processor')
 def test_automated_warning_removed(self):
  self.assertEqual(clean('Philips fixture. Exposed wiring. Not tested. Buyer should inspect condition.'),'Philips fixture.')
 def test_manual_protection(self):
  text='My manual note: cosmetic scuff; untested.'
  self.assertEqual(clean(text,protected={text}),text)
if __name__=='__main__':unittest.main()
