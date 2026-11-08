import unittest,sqlite3
from listing_public_copy import sanitize_item,split_public_research
from listing_persistence import save_fields,ensure_schema
class ManualNotes(unittest.TestCase):
 def test_manual_and_generated_projection(self):
  text='My note: untested. Cosmetic scuff.'
  self.assertEqual(split_public_research('Heater',text,{'description'})['public_description'],text)
  self.assertEqual(split_public_research('Heater','Heater. Untested.')['public_description'],'Heater.')
  item={'fields':{'notes':'Auto assessment','description':'Heater. Untested.'},'visual_recognition':{'notes':'Scratches','status':'partial'}}
  sanitize_item(item);self.assertEqual(item['fields']['notes'],'');self.assertEqual(item['fields']['description'],'Heater.');self.assertNotIn('notes',item['visual_recognition'])
 def test_write_boundary(self):
  db=sqlite3.connect(':memory:');db.execute('CREATE TABLE groups(id TEXT PRIMARY KEY,fields TEXT,updated TEXT)');ensure_schema(db);db.commit()
  out=save_fields(db,'test',{'title':'Heater - Untested','description':'Heater. Cosmetic condition untested.','notes':'Inspect damage','condition':'Used'},source='worker',actor='worker')
  self.assertEqual(out['fields'],{'title':'Heater','description':'Heater.'})
  out=save_fields(db,'test',{'description':'My manual note: untested.','notes':'My manual note: scuffs.'},source='seller_edit',actor='owner_editor',seller_action=True)
  self.assertEqual(out['fields']['notes'],'My manual note: scuffs.')
  out=save_fields(db,'test',{'notes':'automatic override'},source='worker',actor='worker')
  self.assertEqual(out['fields']['notes'],'My manual note: scuffs.')
if __name__=='__main__':unittest.main()
