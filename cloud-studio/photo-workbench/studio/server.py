import argparse
import base64
import hmac
import io
import json
import logging
import mimetypes
import os
import re
import threading
import urllib.parse
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .pipeline import changes_for, checks, inspect, load_catalog, photo, renditions, run_worker
from .store import RequestError, Store


STANDALONE_WEB = Path(__file__).parent / "web"
PORTAL_WEB = Path(__file__).resolve().parents[3] / "stabilization/20261115/live-vercel/src"
ID = r"[a-f0-9]{32}"
CHANNELS = ("storefront", "facebook", "mercari")
PORTAL_METHODS = {"GET", "POST", "PATCH", "PUT"}
PORTAL_HEADERS = {"content-type", "upload-offset"}


class App(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, store, key="", tailnet_owner="", tailnet_host="", portal_origin=""):
        self.store = store
        self.key = key
        self.tailnet_owner = tailnet_owner
        self.tailnet_host = tailnet_host
        self.portal_origin = portal_origin
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if not self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def send_blob(self, body, kind, status=200, download=None):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.cors_headers()
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' blob:; "
                         "style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        if download:
            self.send_header("Content-Disposition", f'attachment; filename="{download}"')
        self.end_headers()
        self.wfile.write(body)

    def reply(self, payload, status=200):
        self.send_blob(json.dumps(payload).encode(), "application/json", status)

    def from_portal(self):
        return (bool(self.server.portal_origin)
                and self.headers.get("Origin") == self.server.portal_origin
                and urllib.parse.urlsplit(self.path).path.startswith("/api/"))

    def cors_headers(self):
        if self.server.portal_origin:
            self.send_header("Vary", "Origin")
        if self.from_portal():
            self.send_header("Access-Control-Allow-Origin", self.server.portal_origin)

    def body(self, limit=256_000):
        try:
            count = int(self.headers["Content-Length"] or "0")
        except (ValueError, TypeError) as error:
            raise RequestError("Invalid request size.") from error
        if not 1 <= count <= limit:
            raise RequestError("Request is empty or too large.", 413)
        content = self.rfile.read(count)
        if len(content) != count:
            raise RequestError("The request stopped before all bytes arrived.")
        return content

    def read_json(self):
        try:
            body = json.loads(self.body())
        except (ValueError, UnicodeError) as error:
            raise RequestError("Invalid JSON.") from error
        if not isinstance(body, dict):
            raise RequestError("Send a JSON object.")
        return body

    def verify_request(self):
        host = self.headers.get("Host", "")
        if self.server.tailnet_owner:
            login = self.headers.get("Tailscale-User-Login", "")
            if (self.client_address[0] != "127.0.0.1" or host.lower() != self.server.tailnet_host
                    or not hmac.compare_digest(login.casefold().encode(), self.server.tailnet_owner.encode())):
                raise RequestError("Connect through Studio’s private Tailscale link.", 403)
        elif not self.server.key and not re.fullmatch(r"(?:127\.0\.0\.1|localhost)(?::\d+)?", host):
            raise RequestError("Studio is private to this device.", 403)
        if self.server.key:
            supplied = self.headers.get("Authorization", "")
            expected = f"Basic {self.server.key}"
            if not hmac.compare_digest(supplied.encode(), expected.encode()):
                self.send_response(401)
                self.send_header("WWW-Authenticate", 'Basic realm="Crazy Moe Studio"')
                self.send_header("Content-Length", "0")
                self.end_headers()
                return False
        origin = self.headers.get("Origin")
        origins = {f"https://{host}"} if self.server.tailnet_owner else {f"http://{host}", f"https://{host}"}
        if origin and origin not in origins and not self.from_portal():
            raise RequestError("Cross-site changes are disabled.", 403)
        return True

    def serve(self):
        try:
            if self.verify_request():
                self.route()
        except RequestError as error:
            self.reply({"error": str(error)}, error.status)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            logging.exception("Studio request failed")
            self.reply({"error": "Studio could not finish this request. Try again."}, 500)

    do_GET = do_POST = do_PATCH = do_PUT = serve

    def do_OPTIONS(self):
        try:
            if not self.from_portal():
                raise RequestError("This origin cannot access the workbench.", 403)
            if not self.verify_request():
                return
            method = self.headers.get("Access-Control-Request-Method")
            headers = {header.strip().lower()
                       for header in self.headers.get("Access-Control-Request-Headers", "").split(",")
                       if header.strip()}
            if method not in PORTAL_METHODS or not headers <= PORTAL_HEADERS:
                raise RequestError("This request is unavailable.", 403)
            self.send_response(204)
            self.cors_headers()
            self.send_header("Access-Control-Allow-Methods", ", ".join(sorted(PORTAL_METHODS)))
            self.send_header("Access-Control-Allow-Headers", ", ".join(sorted(PORTAL_HEADERS)))
            self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Content-Length", "0")
            self.end_headers()
        except RequestError as error:
            self.reply({"error": str(error)}, error.status)

    def route(self):
        store = self.server.store
        method = self.command
        path = urllib.parse.urlsplit(self.path).path
        standalone_assets = {"/": "index.html", "/app.js": "app.js", "/studio.css": "studio.css"}
        portal_assets = {"/": "photo-workbench.html", "/photo-workbench.css": "photo-workbench.css",
                         "/photo-workbench-app.js": "photo-workbench-app.js",
                         "/photo-workbench-connect.js": "photo-workbench-connect.js"}
        assets, web_root = ((standalone_assets, STANDALONE_WEB) if STANDALONE_WEB.is_dir()
                            else (portal_assets, PORTAL_WEB))
        if method == "GET" and path in assets:
            asset = web_root / assets[path]
            return self.send_blob(asset.read_bytes(), mimetypes.guess_type(asset)[0] or "text/plain")
        if method == "GET" and path == "/api/workbench":
            return self.reply({"service": "crazy-moe-photo-workbench", "version": 1})
        if path == "/api/batches" and method == "GET":
            return self.reply(store.batches())
        if path == "/api/batches" and method == "POST":
            data = self.read_json()
            return self.reply(store.batch(store.create(data.get("key"), data.get("files"))), 201)
        match = re.fullmatch(rf"/api/batches/({ID})(?:/(commit|retry|files)/?({ID})?)?", path)
        if match:
            batch, action, asset = match.groups()
            if method == "GET" and not action:
                return self.reply(store.batch(batch))
            if method == "POST" and action == "commit" and not asset:
                store.commit_batch(batch, self.read_json().get("allow_incomplete") is True)
                return self.reply(store.batch(batch))
            if method == "POST" and action == "retry" and not asset:
                store.retry(batch)
                return self.reply(store.batch(batch))
            if method == "PUT" and action == "files" and asset:
                try:
                    offset = int(self.headers.get("Upload-Offset", ""))
                except ValueError as error:
                    raise RequestError("Invalid upload offset.") from error
                return self.reply(store.put(batch, asset, offset, self.body(1024**2), inspect))
        match = re.fullmatch(rf"/api/drafts/({ID})(?:/(approve|transfer|export|copy))?", path)
        if match:
            ident, action = match.groups()
            if method == "PATCH" and not action:
                data = self.read_json()
                draft = store.draft(ident)
                if data.get("revision") != draft["revision"]:
                    raise RequestError("This draft changed. Reload it before saving.", 409)
                changes = changes_for(draft, data)
                for asset in set(changes.get("gallery", [])) - set(draft["gallery"]):
                    renditions(store, {"id": asset})
                return self.reply(store.edit(ident, data.get("revision"), changes, checks))
            if method == "POST" and action == "approve":
                store.approve(ident, self.read_json().get("revision"))
                return self.reply(store.draft(ident))
            if method == "POST" and action == "transfer":
                data = self.read_json()
                store.transfer(ident, data.get("revision"), data.get("photo"), data.get("destination"),
                               data.get("destination_revision"), checks)
                return self.reply(store.batch(store.draft(ident)["batch"]))
            if method == "POST" and action == "export":
                data = self.read_json()
                return self.export(ident, data.get("revision"), data.get("channel"))
            if method == "POST" and action == "copy":
                data = self.read_json()
                draft = self.approved_draft(ident, data.get("revision"), data.get("channel"))
                return self.reply({"text": self.buyer_text(draft)})
        match = re.fullmatch(rf"/api/media/({ID})-(clean|storefront)\.jpg", path)
        if method == "GET" and match:
            asset = store.root / "renders" / (match[1] + "-" + match[2] + ".jpg")
            if asset.is_file():
                return self.send_blob(asset.read_bytes(), "image/jpeg")
        match = re.fullmatch(rf"/api/private-photo/({ID})", path)
        if method == "GET" and match:
            with store.connection() as db:
                row = db.execute("SELECT 1 FROM files WHERE id=? AND state='accepted'", (match[1],)).fetchone()
            if row:
                image = photo(store.root / "uploads" / match[1])
                image.thumbnail((1400, 1400))
                output = io.BytesIO()
                image.save(output, "JPEG", quality=88)
                return self.send_blob(output.getvalue(), "image/jpeg")
        raise RequestError("This page or file could not be found.", 404)

    def approved_draft(self, ident, revision, channel):
        if channel not in CHANNELS:
            raise RequestError("Choose a supported channel.")
        draft = self.server.store.draft(ident)
        if draft["revision"] != revision or draft["approval"] != revision:
            raise RequestError("Approve this exact draft revision before exporting.", 409)
        if channel == "mercari" and (len(draft["description"]) > 1000 or draft["price_cents"] > 200_000):
            raise RequestError("Shorten the description or update the price for your Mercari limits.", 422)
        return draft

    @staticmethod
    def buyer_text(draft):
        price = f"${draft['price_cents'] // 100:,}.{draft['price_cents'] % 100:02d}"
        return f"{draft['title']}\n{price} · {draft['condition']}\n\n{draft['description']}\n"

    def export(self, ident, revision, channel):
        draft = self.approved_draft(ident, revision, channel)
        assets = [draft["cover"]] + [item for item in draft["gallery"] if item != draft["cover"]]
        profile = "storefront" if channel == "storefront" else "clean"
        if channel == "facebook":
            assets = assets[:10]
        elif channel == "mercari":
            assets = assets[:12]
        note = ("Manual draft package. Confirm shipping, eligibility, and account status in Mercari."
                if channel == "mercari" else "Manual draft package. Review before publishing.")
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("listing.txt", self.buyer_text(draft))
            archive.writestr("handoff.txt", note)
            for i, asset in enumerate(assets, 1):
                archive.write(self.server.store.root / "renders" / f"{asset}-{profile}.jpg", f"photos/{i:02}.jpg")
        self.server.store.record_handoff(ident, revision, channel)
        return self.send_blob(output.getvalue(), "application/zip", download=f"crazy-moe-{channel}.zip")


def main():
    parser = argparse.ArgumentParser(description="Run Crazy Moe Studio in a private environment.")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--data", default="./data")
    parser.add_argument("--catalog")
    args = parser.parse_args()
    password = os.getenv("MOE_STUDIO_PASSWORD", "")
    tailnet_owner = os.getenv("MOE_TAILNET_OWNER", "").strip().casefold()
    tailnet_host = os.getenv("MOE_TAILNET_HOST", "").strip().lower()
    portal_origin = os.getenv("MOE_STUDIO_PORTAL_ORIGIN", "").strip()
    if (tailnet_owner or tailnet_host) and not (
        tailnet_owner and re.fullmatch(r"[a-z0-9.-]+\.ts\.net(?::\d+)?", tailnet_host) and args.host == "127.0.0.1"
    ):
        parser.error("Tailscale mode requires both owner and .ts.net host and a loopback bind.")
    if args.host != "127.0.0.1" and not password:
        parser.error("Non-local binding requires MOE_STUDIO_PASSWORD and a private TLS reverse proxy.")
    if portal_origin and (not tailnet_owner or password
                          or not re.fullmatch(r"https://[a-z0-9.-]+(?::[0-9]+)?", portal_origin)):
        parser.error("Portal access requires an exact HTTPS origin and owner-authenticated Tailscale Serve.")
    key = base64.b64encode(("moe:" + password).encode()).decode() if password else ""
    store = Store(args.data)
    stop = threading.Event()
    worker = threading.Thread(target=run_worker, args=(store, load_catalog(args.catalog), stop), daemon=True)
    worker.start()
    with App((args.host, args.port), store, key, tailnet_owner, tailnet_host, portal_origin) as app:
        print(f"Crazy Moe Studio: http://{args.host}:{app.server_port}", flush=True)
        try:
            app.serve_forever()
        except KeyboardInterrupt:
            stop.set()


if __name__ == "__main__":
    main()
