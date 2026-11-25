"""Square Marketplace output with conservative quality gating and reviewed hero framing.

- Source is the exact already-selected listing picture, never raw private references.
- No aspect distortion or content-aware hallucination.
- Only the individually reviewed Tineco cover receives a tighter side crop.
- Automatically falls back to unmodified-square if any crop parameter fails.
- All other product photos preserve their full view (with subdued padding).
"""
from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageOps, ImageEnhance, ImageFilter, ImageDraw
import hashlib, json, logging
import facebook_square as legacy

BASE=legacy.BASE
DEST=legacy.DEST
SOURCES=legacy.SOURCES
SIZE=legacy.SIZE
VERSION="fb-square-premium-v2-20261027"
RULES=BASE/"intake"/"photo_focus_rules.json"
DEST.mkdir(parents=True,exist_ok=True)

def allowed_source(path):
    return legacy.allowed_source(path)

def _read_focus():
    try:
        data=json.loads(RULES.read_text(encoding="utf-8"))
        return data.get("rules",{}) if isinstance(data,dict) else {}
    except (OSError,ValueError,TypeError):
        return {}

def focus_for_source(source):
    """An explicit, individually reviewed source SHA only; not guessed by item title."""
    src=allowed_source(source)
    rules=_read_focus()
    for sha,rule in rules.items():
        if (len(sha)==64 and sha in src.name and
                rule.get("review_status")=="system_visual_checked" and
                rule.get("approved_for")=="square_cover_composition_only"):
            vals=rule.get("crop_box_frac",[])
            if len(vals)!=4:return None
            try:left,top,right,bottom=map(float,vals)
            except (TypeError,ValueError):return None
            if not (0<=left<right<=1 and 0<=top<bottom<=1):return None
            # Product should not lose >45% of source width or >8% of height.
            if (right-left)<.55 or (bottom-top)<.92:return None
            return (left,top,right,bottom)
    return None

def path_for(source):
    p=allowed_source(source)
    st=p.stat()
    focus=focus_for_source(p)
    key=hashlib.sha256((
      str(p).casefold()+"|"+str(st.st_size)+"|"+str(st.st_mtime_ns)+
      "|"+VERSION+"|"+json.dumps(focus)
    ).encode("utf-8")).hexdigest()
    return DEST/(key+"-"+VERSION+".jpg")

def existing(source):
    try:
        p=path_for(source)
        return p if p.is_file() and p.stat().st_size>5000 else None
    except (ValueError,OSError):
        return None

def render(source):
    p=allowed_source(source)
    with Image.open(p) as base:
        base.load()
        full=ImageOps.exif_transpose(base).convert("RGB")
    if min(full.size)<100 or full.width*full.height>70_000_000:
        raise ValueError("Image resolution unsuitable")
    crop_rule=focus_for_source(p)
    if crop_rule:
        l,t,r,b=crop_rule
        box=(round(l*full.width),round(t*full.height),
             round(r*full.width),round(b*full.height))
        if box[2]-box[0]<.55*full.width or box[3]-box[1]<.92*full.height:
            crop_rule=None
    if crop_rule:
        # Side-only trim from individually reviewed real inventory cover.
        selected=full.crop(box)
    else:
        selected=full
    side=1600
    # Soft neutral extension is derived from the same selected photo.
    # Avoid dark gray vignette and hard fake shadow / cut-out effects.
    bg=ImageOps.fit(selected,SIZE,method=Image.Resampling.BILINEAR)
    bg=bg.filter(ImageFilter.GaussianBlur(radius=96))
    bg=ImageEnhance.Color(bg).enhance(.38)
    bg=ImageEnhance.Contrast(bg).enhance(.58)
    bg=Image.blend(bg,Image.new("RGB",SIZE,(241,243,246)),.76)
    # Keep entire selected rectangle. A tall item will remain tall; don't
    # stretch its width merely to fill Marketplace's square thumbnail.
    fg=selected.copy()
    fg.thumbnail((1500,1500),Image.Resampling.LANCZOS)
    x=(side-fg.width)//2;y=(side-fg.height)//2
    # Gentle feather only in 8px outer photo border; don't blur product.
    mask=Image.new("L",fg.size,255)
    if min(fg.size)>70:
        m=ImageDraw.Draw(mask)
        m.rectangle((0,0,fg.width-1,fg.height-1),outline=132,width=6)
        mask=mask.filter(ImageFilter.GaussianBlur(radius=5))
    bg.paste(fg,(x,y),mask)
    return bg,{
      "size":[side,side],"source_size":list(full.size),
      "focal_crop_applied":bool(crop_rule),"focal_crop":crop_rule,
      "full_product_height_preserved":True,"format":"JPEG",
      "no_generatively_invented_item_parts":True,
      "version":VERSION
    }

def ensure(source):
    target=path_for(source)
    if target.is_file() and target.stat().st_size>5000:return target,False
    img,info=render(source)
    temp=target.with_suffix(".tmp")
    try:
        img.save(temp,"JPEG",quality=91,subsampling=0,optimize=True)
        with Image.open(temp) as check:
            check.verify()
        temp.replace(target)
    finally:
        temp.unlink(missing_ok=True)
    return target,True

def batch_missing(groups,lookup,max_new=5):
    completed=[]
    seen=set()
    for g in groups:
        for item in g.get("listing_photos",[]):
            try:
                source=lookup(g,item)
                dest=path_for(source)
                if dest.name in seen or dest.is_file():continue
                seen.add(dest.name)
                _,new=ensure(source)
                if new:completed.append(str(dest))
                if len(completed)>=max_new:return completed
            except (OSError,ValueError) as exc:
                logging.warning("Focus-safe square export skipped: %s",str(exc)[:130])
    return completed
