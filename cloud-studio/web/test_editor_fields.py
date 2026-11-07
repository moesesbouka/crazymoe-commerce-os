"""Browser regression: prefills, seller overrides and save-before-one-click approval."""
import hashlib
import os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

root = Path(__file__).parent
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({'executable_path': os.environ['STUDIO_TEST_CHROME']} if os.environ.get('STUDIO_TEST_CHROME') else {}))
    try:
        for width in (390, 1280):
            for fail_save in (False, True):
                calls = []
                photo = b'\xff\xd8\xff\xd9'
                photo_sha = hashlib.sha256(photo).hexdigest()
                item = dict(id='fixture', lifecycle='current', fields={'price': '60'}, revision=1, status='review',
                            photo_selection=[], generated_candidate={'title': 'Prepared trundle', 'model': 'BT40TBSL', 'price': '100', 'description': 'Prepared description'},
                            identity_revision=1, catalog_evidence=[])
                def route(r):
                    u = urlsplit(r.request.url)
                    if u.netloc == 'studio-fixture.invalid':
                        file = 'index.html' if u.path == '/' else u.path[1:]
                        if file == 'auth.js':
                            r.fulfill(content_type='text/javascript', body="globalThis.studioAuth={auth:{initialize:async()=>({}),getSession:async()=>({data:{session:{access_token:'synthetic'}}}),onAuthStateChange:()=>{}}};")
                        else:
                            r.fulfill(body=(root/file).read_bytes(), content_type='text/javascript' if file.endswith('.js') else 'text/css' if file.endswith('.css') else 'text/html')
                    elif u.path.endswith('/studio_state'): r.fulfill(json=[item])
                    elif u.path.endswith('/studio_render_status'): r.fulfill(json={'state': 'ready', 'revision': item['revision'], 'photo_revision': 1})
                    elif u.path.endswith('/studio_seller_patch'):
                        body = r.request.post_data_json; calls.append('save')
                        assert body['p_expected_revision'] == 1
                        assert body['p_patch']['title'] == 'Seller edited title'
                        assert body['p_patch']['model'] == 'BT40TBSL'
                        assert body['p_patch']['condition'] == 'New'
                        assert 'price' not in body['p_patch']
                        if fail_save: r.fulfill(status=409, json={'code': '40001'})
                        else:
                            item['fields'].update(body['p_patch']); item['revision'] = 2
                            r.fulfill(json=item)
                    elif u.path.endswith('/export-preview'):
                        calls.append('preview'); assert r.request.post_data_json['revision'] == 2
                        r.fulfill(json={'snapshot': dict(item['fields'], id='fixture', revision=2,
                                                        images=[{'sha': photo_sha, 'bytes': len(photo)}]),
                                        'urls': ['https://storage.fixture/photo.jpg']})
                    elif u.netloc == 'storage.fixture':
                        calls.append('photo'); r.fulfill(body=photo, content_type='image/jpeg')
                    elif u.path.endswith('/studio_approve_export'):
                        calls.append('approve')
                        body = r.request.post_data_json
                        assert body['p_item'] == 'fixture' and body['p_revision'] == 2
                        assert body['p_snapshot']['images'][0]['sha'] == photo_sha
                        item['status'] = 'approved'; r.fulfill(json=True)
                    else: r.abort()
                context = browser.new_context(viewport={'width': width, 'height': 850})
                context.route('**/*', route)
                page = context.new_page(); page.set_default_timeout(5000); page.goto('https://studio-fixture.invalid/')
                page.locator('.inventory-card').click()
                assert page.locator('[name=title]').input_value() == 'Prepared trundle'
                assert page.locator('[name=model]').input_value() == 'BT40TBSL'
                assert page.locator('[name=price]').input_value() == '60'
                assert page.locator('[name=condition]').input_value() == 'New'
                page.locator('[name=title]').fill('Seller edited title')
                page.locator('#review-export').click()
                if fail_save:
                    page.get_by_text('This product changed. Copy your edits, close the editor, and refresh before saving.', exact=True).wait_for()
                    assert calls == ['save']
                    assert page.locator('[name=title]').input_value() == 'Seller edited title'
                else:
                    page.get_by_text('Approved — ready for Facebook handoff.', exact=True).wait_for()
                    assert calls == ['save', 'preview', 'photo', 'approve']
                    assert page.locator('#export-dialog').count() == 0
                    page.locator('#close').click(); page.locator('.inventory-card').click()
                    assert page.locator('[name=title]').input_value() == 'Seller edited title'
                    # Deliberately saved blank values must never be replaced by suggestions.
                    assert page.evaluate("editorValue({fields:{title:''},generated_candidate:{title:'old'}},'title')") == ''
                context.close()
        print('PASS: mobile/desktop prefills persist before one-click approval; no redundant modal; seller overrides, blanks, price and failed-save edits preserved')
    finally:
        browser.close()
