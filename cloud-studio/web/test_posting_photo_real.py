"""Read-only archived-photo acceptance in an isolated browser; never opens Facebook."""
import base64,io,json,hashlib
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).parent
URL='https://sfheqjnxlkygjfohoybo.supabase.co/storage/v1/object/public/listing-images/listings/1311528565876309/img_0.jpg'
def main():
 with sync_playwright() as p:
  browser=p.chromium.launch(channel='msedge',headless=True)
  try:
   page=browser.new_page()
   page.route('https://studio.test/**',lambda route:route.fulfill(content_type='text/html',body='<html><body></body></html>'))
   page.goto('https://studio.test/')
   page.add_script_tag(content=(ROOT/'posting-photo.js').read_text())
   result=page.evaluate('''async url=>{
    const source=await PostingPhoto.read(url),result=await PostingPhoto.prepare(url,{profile:'9000000000000002',source:14312});
    return {source:await PostingPhoto.dataUrl(new Blob([source],{type:PostingPhoto.mime(source)})),output:await PostingPhoto.dataUrl(result.blob),manifest:result.manifest,output_sha256:result.output_sha256};
   }''',URL)
   before=base64.b64decode(result['source'].split(',')[1]);after=base64.b64decode(result['output'].split(',')[1]);image=Image.open(io.BytesIO(after))
   assert hashlib.sha256(before).hexdigest()==result['manifest']['source_sha256']
   assert hashlib.sha256(after).hexdigest()==result['output_sha256']
   assert before!=after and image.format=='JPEG'
   assert b'CrazyMoe|alt-frame-v1|source=14312' in image.getexif().get_ifd(0x8769)[0x9286]
   (ROOT/'real-framed-photo.jpg').write_bytes(after)
   print(json.dumps({'real_archived_photo':'PASS','source_id':14312,'size':image.size,'bytes':len(after),'source_preserved':True,'exif_verified':True}),flush=True)
  finally:browser.close()
if __name__=='__main__':main()
