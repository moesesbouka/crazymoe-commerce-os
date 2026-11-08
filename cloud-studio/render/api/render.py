"""Private render preview. No storage writes, approvals or publication."""
from http.server import BaseHTTPRequestHandler
import base64
import json
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen
from renderer import render

ROOT='https://sfheqjnxlkygjfohoybo.supabase.co'
PUBLIC_KEY='sb_publishable_xfIVDlnktUiJYm5U_1jEtw_Res600Af'

class Rejected(Exception):
    def __init__(self,status,message):self.status=status;self.message=message

def cloud(path,authorization,body=None):
    request=Request(ROOT+path,data=None if body is None else json.dumps(body).encode(),
                    headers={'Authorization':authorization,'apikey':PUBLIC_KEY,'Content-Type':'application/json'})
    try:
        with urlopen(request,timeout=25) as response:
            data=response.read(2_000_001)
            if len(data)>2_000_000:raise Rejected(502,'Cloud response too large')
            return json.loads(data)
    except HTTPError as error:
        raise Rejected(error.code if error.code in (401,403,409) else 502,'Cloud request rejected') from None

def prepare(body,authorization):
    if not authorization.startswith('Bearer ') or len(authorization)>8192:
        raise Rejected(401,'Sign in required')
    if not isinstance(body,dict) or set(body)!={'id','revision','photo_revision','index'}:
        raise Rejected(400,'Current product and photo revisions required')
    if not isinstance(body['id'],str) or len(body['id'])>100 or any(type(body[k]) is not int for k in ('revision','photo_revision','index')):
        raise Rejected(400,'Invalid selection')
    # JWT verification and enabled membership are enforced by Studio API/RPC.
    state=cloud('/functions/v1/studio-api/inventory',authorization)
    item=next((i for i in state['items'] if i['id']==body['id']),None)
    if not item or item['revision']!=body['revision'] or item['lifecycle']!='current':
        raise Rejected(409,'Product changed')
    if item.get('exports_verified'):
        raise Rejected(409,'Use the existing verified JPEG exports')
    def check_revision():
        revision=cloud('/rest/v1/rpc/studio_photo_choices',authorization,{'p_item':item['id']})
        if revision['revision']!=body['photo_revision'] or revision['listing_revision']!=body['revision']:
            raise Rejected(409,'Listing or selected photos changed')
    check_revision()
    photos=item['photo_selection']
    if not 0<=body['index']<len(photos):raise Rejected(400,'Photo not selected')
    selected=photos[body['index']]
    kind=selected['kind']
    if kind=='real':path='photo/'+quote(selected['sha'],safe='')
    elif kind=='manufacturer':path='reference/'+quote(item['id'],safe='')+'/'+quote(selected['id'],safe='')
    else:raise Rejected(400,'Unsupported photo kind')
    access=cloud('/functions/v1/studio-api/'+path,authorization)
    parsed=urlsplit(access['url'])
    if parsed.scheme!='https' or parsed.netloc!=urlsplit(ROOT).netloc or not parsed.path.startswith('/storage/v1/object/sign/'):
        raise Rejected(502,'Invalid private photo location')
    with urlopen(access['url'],timeout=25) as response:
        if urlsplit(response.url).netloc!=urlsplit(ROOT).netloc:raise Rejected(502,'Unexpected photo redirect')
        payload=response.read(16_000_001)
    if len(payload)>16_000_000:raise Rejected(413,'Photo too large')
    image,receipt=render(payload,access['sha256'],kind=kind,
                         style=selected.get('style_mode','natural'),pop=selected.get('pop',False))
    check_revision()
    if len(image)>4_000_000:raise Rejected(413,'Rendered JPEG too large')
    receipt.update(inventory_id=item['id'],revision=body['revision'],photo_revision=body['photo_revision'],index=body['index'])
    return image,receipt

class handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass  # Do not log tokens, signed URLs or seller data.
    def respond(self,status,payload,kind='application/json',receipt=None):
        self.send_response(status)
        self.send_header('Content-Type',kind)
        self.send_header('Cache-Control','private, no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Length',str(len(payload)))
        if receipt:self.send_header('X-Studio-Render',base64.b64encode(json.dumps(receipt,separators=(',',':')).encode()).decode())
        self.end_headers();self.wfile.write(payload)
    def do_GET(self):self.respond(405,b'{"error":"POST required"}')
    def do_POST(self):
        try:
            auth=self.headers.get('Authorization','')
            if not auth.startswith('Bearer '):raise Rejected(401,'Sign in required')
            length=int(self.headers.get('Content-Length','0'))
            if not 1<=length<=2048:raise Rejected(400,'Invalid request size')
            image,receipt=prepare(json.loads(self.rfile.read(length)),auth)
            self.respond(200,image,'image/jpeg',receipt)
        except Rejected as error:self.respond(error.status,json.dumps({'error':error.message}).encode())
        except (ValueError,KeyError,TypeError):self.respond(400,b'{"error":"Invalid photo request"}')
        except Exception:self.respond(502,b'{"error":"Rendering unavailable"}')
