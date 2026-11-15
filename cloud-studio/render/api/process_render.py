"""Machine-only photo rendering. No database privileges or office dependencies."""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from io import BytesIO
import hashlib
import hmac
import json
import os
from PIL import Image
from renderer import render

HOST='sfheqjnxlkygjfohoybo.supabase.co'
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise ValueError('Photo redirects forbidden')

def process(body,authorization,secret=None,opener=None):
    secret=os.environ.get('STUDIO_RENDER_SECRET','') if secret is None else secret
    if len(secret)<64 or not hmac.compare_digest(authorization,'Bearer '+secret):
        raise PermissionError('Worker authentication required')
    if not isinstance(body,dict) or set(body)!={'url','sha256','bytes','style','pop'}:
        raise ValueError('Invalid render request')
    url=urlsplit(body['url'])
    if url.scheme!='https' or url.netloc!=HOST or not url.path.startswith('/storage/v1/object/sign/studio-originals/') or url.fragment:
        raise ValueError('Invalid private photo URL')
    sha=body['sha256']
    if not isinstance(sha,str) or len(sha)!=64 or any(c not in '0123456789abcdef' for c in sha):
        raise ValueError('Invalid source digest')
    if type(body['bytes']) is not int or not 1<=body['bytes']<=16000000:
        raise ValueError('Invalid source size')
    if body['style'] not in ('natural','blur','brand') or type(body['pop']) is not bool:
        raise ValueError('Invalid recipe options')
    opener=opener or build_opener(NoRedirect())
    with opener.open(Request(body['url']),timeout=25) as response:
        payload=response.read(body['bytes']+1)
    if len(payload)!=body['bytes'] or hashlib.sha256(payload).hexdigest()!=sha:
        raise ValueError('Source receipt mismatch')
    image,receipt=render(payload,sha,style=body['style'],pop=body['pop'])
    if len(image)>4000000:raise ValueError('Rendered output too large')
    with Image.open(BytesIO(image)) as decoded:
        if decoded.format!='JPEG' or decoded.size!=(1600,1600):raise ValueError('Invalid rendered JPEG')
        decoded.verify()
    return image,receipt

class handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def reply(self,status,data,kind='application/json'):
        self.send_response(status);self.send_header('Content-Type',kind)
        self.send_header('Cache-Control','private, no-store');self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_GET(self):self.reply(405,b'{"error":"POST required"}')
    def do_POST(self):
        try:
            secret=os.environ.get('STUDIO_RENDER_SECRET','')
            authorization=self.headers.get('Authorization','')
            if len(secret)<64 or not hmac.compare_digest(authorization,'Bearer '+secret):raise PermissionError()
            length=int(self.headers.get('Content-Length','0'))
            if not 1<=length<=8192:raise ValueError()
            image,_=process(json.loads(self.rfile.read(length)),authorization)
            self.reply(200,image,'image/jpeg')
        except PermissionError:self.reply(401,b'{"error":"Worker authentication required"}')
        except (ValueError,TypeError,KeyError):self.reply(400,b'{"error":"Invalid render request or source"}')
        except Exception:self.reply(502,b'{"error":"Render unavailable"}')
