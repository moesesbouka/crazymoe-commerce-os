"""Exercise the deployed auth client against isolated provider and inventory fixtures."""
import base64
import json
from pathlib import Path
import time
from urllib.parse import urlsplit, parse_qs, urlencode
from playwright.sync_api import sync_playwright

web = Path(__file__).resolve().parent.parent
origin = "https://crazymoe-marketplace-studio.vercel.app"
backend = "https://sfheqjnxlkygjfohoybo.supabase.co"
user = {"id":"11111111-2222-4333-8444-555555555555","aud":"authenticated","role":"authenticated","email":"fixture@example.invalid"}
def auth_session(seconds=3600):
    expiry = int(time.time()) + seconds
    def encode(data):
        return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")
    return {"access_token":encode({"alg":"HS256","typ":"JWT"})+"."+encode({"sub":user["id"],"exp":expiry,"aud":"authenticated"})+".fixture",
            "refresh_token":"fixture-refresh","expires_at":expiry,"expires_in":seconds,"token_type":"bearer","user":user}
inventory=[{"id":"fixture-product","fields":{"title":"Test inventory","price":"99"},"status":"review"}]
events=[]
def serve(route):
    request=route.request
    url=urlsplit(request.url)
    if url.scheme+"://"+url.netloc==origin:
        filename="index.html" if url.path=="/app/" else url.path.lstrip("/")
        mime="text/javascript" if filename.endswith(".js") else "text/css" if filename.endswith(".css") else "text/html"
        route.fulfill(body=(web/filename).read_bytes(),content_type=mime)
        return
    if url.scheme+"://"+url.netloc!=backend:
        route.abort()
        return
    body={}
    if url.path=="/auth/v1/otp":
        assert request.post_data_json["create_user"] is False
        assert parse_qs(url.query)["redirect_to"]==[origin+"/app/"]
        events.append("email")
    elif url.path=="/auth/v1/user":body=user
    elif url.path=="/auth/v1/token":
        events.append("refresh")
        body=auth_session()
    elif url.path=="/auth/v1/logout":events.append("logout")
    elif url.path=="/rest/v1/rpc/studio_state":
        assert request.headers["authorization"].startswith("Bearer ")
        body=inventory
    else:raise AssertionError(url.path)
    route.fulfill(json=body)

with sync_playwright() as p:
    print("Launching isolated browser",flush=True)
    browser=p.chromium.launch(channel="chromium",headless=True)
    try:
        print("Browser launched",flush=True)
        context=browser.new_context()
        context.set_default_timeout(12000)
        context.route("**/*",serve)
        page=context.new_page()
        print("Open sign-in",flush=True)
        page.goto(origin+"/app/")
        page.locator("#email-signin input").fill(user["email"])
        page.get_by_role("button",name="Email me a sign-in link",exact=True).click()
        page.get_by_text("Check your email and click the newest sign-in link to open Studio.",exact=True).wait_for()
        assert "email" in events
        print("Email request passed",flush=True)
        session=auth_session()
        fragment=urlencode({k:session[k] for k in ("access_token","refresh_token","expires_in","token_type")})+"&type=magiclink"
        page.goto("about:blank")
        page.goto(origin+"/app/#"+fragment)
        page.get_by_role("button",name="Test inventory",exact=False).wait_for()
        assert not urlsplit(page.url).fragment
        print("Callback passed",flush=True)
        page.reload()
        page.get_by_role("button",name="Test inventory",exact=False).wait_for()
        print("Reload passed",flush=True)
        second=context.new_page()
        second.goto(origin+"/app/")
        second.get_by_role("button",name="Test inventory",exact=False).wait_for()
        print("Second tab passed",flush=True)
        page.get_by_role("button",name="Sign out",exact=True).click()
        page.locator("#login").wait_for(state="visible")
        second.locator("#login").wait_for(state="visible")
        assert "logout" in events
        print("Signout passed",flush=True)
        page.goto("about:blank")
        page.goto(origin+"/app/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")
        page.wait_for_function("document.querySelector('#login-status').textContent.includes('expired')")
        assert not urlsplit(page.url).fragment
        context.close()
        rotated=browser.new_context(storage_state={"cookies":[],"origins":[{"origin":origin,"localStorage":[{"name":"crazymoe-studio-auth","value":json.dumps(auth_session(-1))}]}]})
        rotated.route("**/*",serve)
        page=rotated.new_page()
        page.goto(origin+"/app/")
        page.get_by_role("button",name="Test inventory",exact=False).wait_for()
        assert "refresh" in events
        rotated.close()
        print(json.dumps({"email_request":True,"callback":True,"refresh_persists":True,"second_tab_persists":True,"signout_both_tabs":True,"expired_link_feedback":True,"token_renewal":True,"mock_auth":True}))
    finally:browser.close()
