"""Read public product evidence for identifiers observed in Studio photos."""

import base64
import html
import http.client
import ipaddress
import json
import re
import socket
import threading
import time
import urllib.parse
import urllib.request
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from html.parser import HTMLParser


STORES = {
    "amazon.com", "bestbuy.com", "bhphotovideo.com", "costco.com", "homedepot.com",
    "lowes.com", "officedepot.com", "sharkninja.com", "staples.com", "target.com",
    "walmart.com", "wayfair.com", "xgimi.com", "kodakphotoplus.com",
}
SEARCH = {"www.bing.com", "html.duckduckgo.com", "search.yahoo.com"}
CATALOG_API = "https://api.upcitemdb.com/prod/trial/"
CATALOG_MERCHANTS = {"amazon", "bestbuy", "bhphotovideo", "homedepot", "lowes",
                     "officedepot", "staples", "target", "walmartcom", "walmart", "wayfair"}
CATALOG_AFFILIATES = {"www.dpbolvw.net", "www.jdoqocy.com", "homedepot.sjv.io",
                      "bestbuy.7tiv.net", "goto.target.com"}
CATALOG_LOCK = threading.Lock()
catalog_next = 0
AVAILABLE = {"InStock", "LimitedAvailability", "OnlineOnly"}
MODEL_ID = re.compile(r"[A-Z0-9][A-Z0-9./-]{2,23}", re.ASCII)
STANDALONE_MODEL = re.compile(r"[A-Z]{1,6}[- ]?[0-9]{3,7}(?:-[A-Z]{1,5})?", re.ASCII)
PRODUCT_WORDS = re.compile(r"\b(?:lamp|projector|coffee maker|receiver|soundbar|tool|speaker|ice maker|toilet seat|scale|vacuum)\b", re.I)
PRIVATE_WORDS = re.compile(r"\b(?:serial|s/n|imei|tracking|invoice|ship to|order number)\b", re.I)
BUNDLE = re.compile(r"\b(?:bundle|lot of|pack of [2-9]|[2-9][ -]pack|refurbished|renewed|pre[ -]owned|used condition|for parts)\b", re.I)
SPEC_LABELS = {
    "capacity", "color", "connectivity", "dimensions", "display resolution",
    "height", "length", "material", "native resolution", "power",
    "screen size", "size", "voltage", "wattage", "weight", "width",
}


def normalized_id(value):
    return re.sub(r"[^A-Z0-9]", "", str(value).upper())


def valid_gtin(value):
    value = str(value).strip()
    if len(value) not in (8, 12, 13, 14) or not re.fullmatch(r"[0-9]+", value):
        return None
    checksum = sum((3 if i % 2 == 0 else 1) * int(n) for i, n in enumerate(reversed(value[:-1])))
    return value.lstrip("0") if (checksum + int(value[-1])) % 10 == 0 and value.strip("0") else None


def model_term(value, allow_digits=False):
    value = str(value).strip().upper()
    if not MODEL_ID.fullmatch(value) or not any(c.isdigit() for c in value):
        return None
    if value.isdigit():
        return value if allow_digits and 5 <= len(value) <= 8 else None
    if len(normalized_id(value)) < 4 or not any(c.isalpha() for c in value):
        return None
    return value


def photo_identifiers(rows, item=None):
    """Only send short printed model identifiers or checksum-valid product codes."""
    if item:
        primary = model_term(item["model"].replace(" ", "-"), allow_digits=True)
        return (primary,) if primary else ()
    printed, product_codes, nearby = [], [], []
    for record, _ in rows:
        for barcode in sorted(record.get("gtins", ())):
            if valid_gtin(barcode):
                product_codes.append(str(barcode))
        for token in sorted(record.get("tokens", ())):
            if identifier := model_term(token, allow_digits=True):
                printed.append(identifier)
        lines = [line.strip() for line in (record.get("text") or "").splitlines() if line.strip()]
        for index, line in enumerate(lines):
            context = " ".join(lines[max(0, index - 1):index + 2])
            token = line.strip().upper()
            if (STANDALONE_MODEL.fullmatch(token) and PRODUCT_WORDS.search(context)
                    and not PRIVATE_WORDS.search(context)):
                nearby.append(token.replace(" ", "-"))
    models = printed or nearby
    if len({normalized_id(value) for value in models}) > 1 or len({valid_gtin(value) for value in product_codes}) > 1:
        return ()
    return tuple(dict.fromkeys([*product_codes, *models]))[:2]


def store_host(url):
    try:
        parsed = urllib.parse.urlsplit(url)
        hostname = parsed.hostname or ""
        if (parsed.scheme != "https" or parsed.username or parsed.password
                or parsed.port not in (None, 443)):
            return ""
        return next((host for host in STORES if hostname == host or hostname.endswith("." + host)), "")
    except (TypeError, ValueError):
        return ""


def safe_url(url):
    parsed = urllib.parse.urlsplit(url)
    catalog = ((parsed.hostname == "api.upcitemdb.com" and parsed.path in ("/prod/trial/search", "/prod/trial/lookup"))
               or (parsed.hostname == "www.upcitemdb.com" and parsed.path == "/norob/alink/"))
    if not store_host(url) and (parsed.scheme != "https" or (parsed.hostname not in SEARCH and not catalog)
                               or parsed.username or parsed.password or parsed.port not in (None, 443)):
        raise ValueError("Unexpected product evidence host.")
    addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(address[4][0]).is_global for address in addresses):
        raise ValueError("Product evidence host must resolve publicly.")
    return url


class PublicRedirect(urllib.request.HTTPRedirectHandler):
    max_redirections = 4

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        direct = merchant_target(req.full_url, newurl)
        return super().redirect_request(req, fp, code, msg, headers, safe_url(direct))


def merchant_target(source, location):
    if urllib.parse.urlsplit(source).hostname != "www.upcitemdb.com":
        return location
    parsed = urllib.parse.urlsplit(location)
    if parsed.hostname not in CATALOG_AFFILIATES:
        return location
    query = urllib.parse.parse_qs(parsed.query)
    destination = (query.get("url") or query.get("u") or [""])[0]
    if destination.startswith("http://"):
        destination = "https://" + destination.removeprefix("http://")
    return destination if store_host(destination) else location


def fetch(url, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return None
    try:
        api = url.startswith(CATALOG_API)
        request = urllib.request.Request(safe_url(url), headers={
            "User-Agent": "Mozilla/5.0 (compatible; CrazyMoeProductResearch/1.0)",
            "Accept": "application/json" if api else "text/html,application/xhtml+xml",
        })
        with urllib.request.build_opener(PublicRedirect()).open(request, timeout=min(7, remaining)) as page:
            if ("json" if api else "html") not in page.headers.get("Content-Type", "").lower():
                return None
            chunks = bytearray()
            while len(chunks) < 4_000_000 and time.monotonic() < deadline:
                data = page.read1(65536)
                if not data:
                    return page.geturl(), chunks.decode("utf-8", errors="replace")
                chunks.extend(data)
            return page.geturl(), chunks.decode("utf-8", errors="replace")
    except (OSError, ValueError, http.client.HTTPException):
        return None


def text_value(value, limit=160):
    if not isinstance(value, (str, int, float)):
        return ""
    value = " ".join(html.unescape(str(value)).split())
    return value[:limit] if not re.search(r"[<>@\x00-\x1f]", value) else ""


class PageEvidence(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks = []
        self.links = []
        self._script = None

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == "a" and attrs.get("href"):
            self.links.append(attrs["href"])
        if tag == "script":
            kind = attrs.get("type", "").lower()
            if kind == "application/ld+json" or attrs.get("id") == "__NEXT_DATA__":
                self._script = (kind, [])

    def handle_data(self, data):
        if self._script is not None:
            self._script[1].append(data)

    def handle_endtag(self, tag):
        if tag != "script" or self._script is None:
            return
        kind, pieces = self._script
        self._script = None
        try:
            node = json.loads("".join(pieces))
        except (ValueError, RecursionError):
            return
        if kind == "application/ld+json":
            self.blocks.append(node)
        else:
            # Use the primary retailer product, never recommendation tiles.
            primary = walmart_product(node)
            if primary:
                self.blocks.append(primary)


def walmart_product(node):
    if not isinstance(node, dict):
        return None
    item = node
    for key in ("props", "pageProps", "initialData", "data", "product"):
        if not isinstance(item, dict):
            return None
        item = item.get(key)
    if not isinstance(item, dict) or not item.get("name"):
        return None
    details = item.get("priceInfo")
    price = details.get("currentPrice") if isinstance(details, dict) else None
    if not isinstance(price, dict):
        price = {}
    stock = item.get("availabilityStatus")
    seller = item.get("sellerName") or item.get("sellerDisplayName")
    return {"@type": "Product", "name": item["name"], "brand": item.get("brand"),
            "mpn": item.get("modelNumber") or item.get("manufacturerPartNumber"),
            "gtin": item.get("upc"), "color": item.get("color"), "category": item.get("productType"),
            "offers": {"@type": "Offer", "price": price.get("price"),
                       "priceCurrency": price.get("currencyUnit"), "availability": "InStock" if stock == "IN_STOCK" else "",
                       "seller": {"name": seller} if seller else None}}


def products(node):
    if isinstance(node, list):
        for child in node:
            yield from products(child)
    elif isinstance(node, dict):
        tags = node.get("@type", [])
        if isinstance(tags, str):
            tags = [tags]
        if isinstance(tags, list) and ("Product" in tags or "https://schema.org/Product" in tags):
            yield node
        for key in ("@graph", "mainEntity", "hasVariant"):
            if key in node:
                yield from products(node[key])


def name_has_model(name, identifier):
    pattern = r"(?<![A-Z0-9])" + r"[-./\s]*".join(map(re.escape, normalized_id(identifier))) + r"(?![A-Z0-9])"
    return len(normalized_id(identifier)) >= 4 and bool(re.search(pattern, name.upper()))


def match_product(node, identifier):
    target = valid_gtin(identifier)
    if target:
        return any(valid_gtin(node.get(field)) == target
                   for field in ("gtin", "gtin8", "gtin12", "gtin13", "gtin14", "upc"))
    declared = [text_value(node.get(key)) for key in ("mpn", "model") if text_value(node.get(key))]
    if declared:
        return all(normalized_id(value) == normalized_id(identifier) for value in declared)
    # Structured single-product names can carry the exact manufacturer model.
    return name_has_model(text_value(node.get("name")), identifier)


def retail_price(offers):
    if isinstance(offers, dict):
        offers = [offers]
    for offer in offers if isinstance(offers, list) else []:
        if not isinstance(offer, dict) or offer.get("@type") not in ("Offer", "https://schema.org/Offer"):
            continue
        currency = offer.get("priceCurrency")
        availability = str(offer.get("availability", "")).rsplit("/", 1)[-1]
        condition = str(offer.get("itemCondition", "NewCondition")).rsplit("/", 1)[-1]
        if currency != "USD" or availability not in AVAILABLE or condition != "NewCondition":
            continue
        try:
            value = Decimal(str(offer.get("price")))
            if value.is_finite() and Decimal("0") < value <= Decimal("1000000"):
                seller = offer.get("seller")
                named_seller = text_value(seller.get("name")) if isinstance(seller, dict) else ""
                return int((value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)), named_seller
        except (InvalidOperation, ValueError):
            continue
    return None, ""


def evidence_from_page(url, body, identifier):
    host = store_host(url)
    if not host:
        return None
    page = PageEvidence()
    page.feed(body)
    matches = [p for block in page.blocks for p in products(block)
               if match_product(p, identifier) and text_value(p.get("name"))
               and not BUNDLE.search(text_value(p.get("name")))]
    # A page presenting conflicting variants must not supply a price.
    if not matches or len({text_value(row["name"]).casefold() for row in matches}) != 1:
        return None
    node = matches[0]
    title = text_value(node.get("name"), 150)
    brand = node.get("brand")
    brand = text_value(brand.get("name") if isinstance(brand, dict) else brand, 60)
    declared = text_value(node.get("mpn")) or text_value(node.get("model"))
    code = model_term(declared, allow_digits=True) or identifier
    specs = {"Model" if not valid_gtin(code) else "GTIN": code}
    for field in ("color", "size", "material", "category"):
        if value := text_value(node.get(field), 80):
            specs[field.title()] = value
    properties = node.get("additionalProperty")
    for prop in properties if isinstance(properties, list) else []:
        if isinstance(prop, dict) and text_value(prop.get("name")).lower() in SPEC_LABELS:
            if value := text_value(prop.get("value"), 90):
                specs[text_value(prop["name"], 30)] = value
        if len(specs) >= 8:
            break
    cents, seller = next(
        (price for match in matches if (price := retail_price(match.get("offers")))[0] is not None), (None, "")
    )
    parsed = urllib.parse.urlsplit(url)
    return {"title": title, "brand": brand, "model": code, "specs": specs,
            "cents": cents, "seller": seller or host, "host": host,
            "url": urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))}


def product_links(body):
    parser = PageEvidence()
    parser.feed(body)
    for raw in parser.links:
        try:
            link = urllib.parse.urlsplit(raw)
            query = urllib.parse.parse_qs(link.query)
            if link.hostname in ("www.bing.com", "bing.com") and link.path == "/ck/a":
                code = query.get("u", [""])[0]
                if code.startswith("a1"):
                    raw = base64.urlsafe_b64decode(code[2:] + "===").decode("utf-8")
            elif link.path == "/l/" and link.hostname in (None, "duckduckgo.com", "html.duckduckgo.com"):
                raw = query.get("uddg", [""])[0]
            elif link.hostname == "r.search.yahoo.com":
                wrapped = re.search(r"/RU=([^/]+)", link.path)
                if wrapped:
                    raw = urllib.parse.unquote(wrapped[1])
            host = store_host(raw)
            if host:
                parsed = urllib.parse.urlsplit(raw)
                if parsed.path not in ("", "/") and not re.search(r"/(?:search|browse|category)(?:/|$)", parsed.path):
                    yield urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
        except (ValueError, UnicodeError):
            continue


def catalog_items(body, identifier):
    try:
        items = json.loads(body).get("items", [])
    except (AttributeError, ValueError, RecursionError):
        return []
    if not isinstance(items, list):
        return []
    barcode = valid_gtin(identifier)
    return [item for item in items if isinstance(item, dict) and text_value(item.get("title"))
            and not BUNDLE.search(text_value(item.get("title")))
            and (valid_gtin(item.get("upc") or item.get("ean")) == barcode if barcode
                 else normalized_id(item.get("model", "")) == normalized_id(identifier))]


def extra_catalog(identifier, deadline, read):
    global catalog_next
    with CATALOG_LOCK:
        start = max(time.monotonic(), catalog_next)
        if start + 6 >= deadline:
            return [], None
        catalog_next = start + 15
    time.sleep(max(0, start - time.monotonic()))
    param = "lookup?upc=" if valid_gtin(identifier) else "search?s="
    if not (page := read(CATALOG_API + param + urllib.parse.quote(identifier), deadline)):
        return [], None
    items = catalog_items(page[1], identifier)
    if not items:
        return [], None
    links = []
    for item in items:
        offers = item.get("offers")
        for offer in offers if isinstance(offers, list) else []:
            if not isinstance(offer, dict) or normalized_id(offer.get("merchant", "")).lower() not in CATALOG_MERCHANTS:
                continue
            link = offer.get("link")
            if isinstance(link, str) and (store_host(link) or link.startswith("https://www.upcitemdb.com/norob/alink/?")):
                links.append(link)
    return list(dict.fromkeys(links)), items[0]


def matching_pages(candidates, identifier, deadline, read):
    unique = list(dict.fromkeys(candidates))
    distinct = list({store_host(u): u for u in reversed(unique) if store_host(u)}.values())[::-1]
    results = []
    for url in list(dict.fromkeys([*distinct, *unique]))[:12]:
        if time.monotonic() >= deadline or len(results) >= 4:
            break
        if not (page := read(url, deadline)):
            continue
        if matched := evidence_from_page(*page, identifier):
            results.append(matched)
    return results


def lookup_product(identifiers, known=None, deadline=None, read=fetch):
    deadline = deadline if deadline is not None else time.monotonic() + 35
    # The catalogue may identify a family. A live offer for a different variant cannot price it.
    if known and known.get("price_identifiers"):
        return None
    existing = [o["url"] for o in (known or {}).get("observations", []) if store_host(o.get("url"))]
    for identifier in identifiers:
        if time.monotonic() >= deadline:
            break
        query = urllib.parse.quote('"' + identifier + '"')
        candidates = list(existing)
        for search_url in ("https://search.yahoo.com/search?p=" + query,
                           "https://www.bing.com/search?q=" + query,
                           "https://html.duckduckgo.com/html/?q=" + query):
            if result := read(search_url, deadline):
                candidates.extend(product_links(result[1]))
        results = matching_pages(candidates, identifier, deadline, read)
        backup = None
        if not any(row["cents"] is not None for row in results):
            links, backup = extra_catalog(identifier, deadline, read)
            results.extend(matching_pages(links, identifier, deadline, read))
        if not results:
            if backup:
                model = model_term(backup.get("model"), allow_digits=True) or identifier
                title = text_value(backup["title"], 150)
                code = backup.get("upc") or backup.get("ean")
                return {"model": model, "title": title, "description": title + ".",
                        "specs": {"Model": model}, "observations": [],
                        "identity_sources": [f"https://www.upcitemdb.com/upc/{code}"] if valid_gtin(code) else []}
            continue
        model = (known or {}).get("model", results[0]["model"])
        if len({normalized_id(row["model"]) for row in results}) > 1 and not valid_gtin(identifier):
            continue
        lead = max(results, key=lambda row: len(row["specs"]))
        offers, merchants = [], set()
        for row in results:
            merchant = normalized_id(row["seller"])
            if row["cents"] is not None and merchant not in merchants:
                merchants.add(merchant)
                offers.append({"model": model, "kind": "retail", "date": date.today().isoformat(),
                               "url": row["url"], "cents": row["cents"]})
        return {"model": model, "title": lead["title"], "specs": lead["specs"],
                "description": lead["title"] + ".", "identity_sources": [row["url"] for row in results],
                "observations": offers, "single_source_price": True}
    return None
