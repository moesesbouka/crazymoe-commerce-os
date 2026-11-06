"""Non-destructive Facebook Marketplace square export, 1600px x 1600px JPEG.

Do not crop the actual selected listing media. Center full photo with a soft,
subdued extension of its own background. Derive only from already-approved
real inventory finishing variants / official manufacturer media in draft order.
Never change the source file, user cover/order, or private label images.
"""
from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageOps, ImageEnhance, ImageFilter, ImageDraw
import hashlib
import json
import os
import tempfile

BASE=Path.home()/"Documents"/"Moe-Marketplace-Workflow"
DEST=BASE/"Prepared-Photos"/"facebook-square"
SOURCES=tuple((BASE/"Prepared-Photos"/name).resolve() for name in ("enhanced","styled","manufacturer")) + ((BASE/"Marketplace-Inbox"/"originals").resolve(),)
VERSION="fb-square-1600-v1"
SIZE=(1600,1600)
DEST.mkdir(parents=True,exist_ok=True)

def allowed_source(source):
    try:
        p=Path(source).resolve(strict=True)
    except (OSError,RuntimeError):
        raise ValueError("Listing source unavailable")
    if not p.is_file() or p.parent not in SOURCES:
        raise ValueError("Only existing approved listing images may be exported")
    if p.suffix.lower() not in (".jpg",".jpeg",".png",".webp",".heic",".heif"):
        raise ValueError("Unsupported source image")
    return p

def path_for(source):
    p=allowed_source(source)
    st=p.stat()
    material=(str(p).casefold()+"|"+str(st.st_size)+"|"+str(st.st_mtime_ns)+"|"+VERSION).encode("utf-8")
    key=hashlib.sha256(material).hexdigest()
    return DEST/(key+"-"+VERSION+".jpg")

def existing(source):
    try:
        path=path_for(source)
        return path if path.is_file() and path.stat().st_size>5000 else None
    except (ValueError,OSError):
        return None

def render(source):
    p=allowed_source(source)
    with Image.open(p) as im:
        im.load()
        im=ImageOps.exif_transpose(im).convert("RGB")
    if im.width<100 or im.height<100 or im.width*im.height>70_000_000:
        raise ValueError("Unusable image dimensions")
    side=SIZE[0]
    # Background uses source colors only, heavily softened to avoid cloned
    # furniture and product ghosts. No generated substitute product.
    bg=ImageOps.fit(im,(side,side),method=Image.Resampling.BILINEAR,centering=(.5,.5))
    bg=bg.filter(ImageFilter.GaussianBlur(radius=65))
    bg=ImageEnhance.Color(bg).enhance(.48)
    bg=ImageEnhance.Contrast(bg).enhance(.65)
    bg=Image.blend(bg,Image.new("RGB",SIZE,(235,239,243)),.52)

    # 5% safety margin. Exact full image preserved; only downscale, never crop.
    w,h=im.size
    scale=min(1.0,1470.0/w,1470.0/h)
    nw=max(1,round(w*scale));nh=max(1,round(h*scale))
    picture=im.resize((nw,nh),Image.Resampling.LANCZOS) if scale<1 else im
    x=(side-nw)//2;y=(side-nh)//2
    # Soft shadow belongs only around the photo rectangle, not inside objects.
    shade=Image.new("RGBA",SIZE,(0,0,0,0))
    overlay=Image.new("L",SIZE,0)
    dr=ImageDraw.Draw(overlay)
    dr.rounded_rectangle((x+3,y+4,x+nw+3,y+nh+4),radius=15,fill=56)
    overlay=overlay.filter(ImageFilter.GaussianBlur(radius=20))
    shade.putalpha(overlay)
    background=Image.alpha_composite(bg.convert("RGBA"),shade)
    # Minimal 4-pixel edge feather to avoid pasted-on rectangles without
    # affecting the original product, cords, text or accessories.
    inset_mask=Image.new("L",(nw,nh),255)
    if min(nw,nh)>80:
        mask_draw=ImageDraw.Draw(inset_mask)
        mask_draw.rectangle((0,0,nw-1,nh-1),outline=165,width=3)
        inset_mask=inset_mask.filter(ImageFilter.GaussianBlur(radius=2))
    layer=Image.new("RGBA",SIZE,(0,0,0,0))
    layer.paste(picture,(x,y),inset_mask)
    return Image.alpha_composite(background,layer).convert("RGB"),{
      "size":[side,side],"format":"JPEG","source":[w,h],
      "fitted":[nw,nh],"offset":[x,y],
      "no_subject_cropping":True,"padding":"subdued background extension",
      "quality":91,"version":VERSION
    }

def ensure(source):
    expected=path_for(source)
    if expected.is_file() and expected.stat().st_size>5000:
        return expected,False
    im,details=render(source)
    tmp=expected.with_suffix(".tmp")
    try:
        im.save(tmp,format="JPEG",quality=91,subsampling=0,optimize=True)
        with Image.open(tmp) as check:
            check.verify()
        tmp.replace(expected)
    finally:tmp.unlink(missing_ok=True)
    return expected,True

def batch_missing(groups,lookup,max_new=5):
    """Process listing media only, excluding private labels by construction."""
    completed=[]
    seen=set()
    for g in groups:
        selected=g.get("listing_photos",[])
        for item in selected:
            try:
                source=lookup(g,item)
                path=path_for(source)
                if path.name in seen or path.is_file():continue
                seen.add(path.name)
                out,new=ensure(source)
                if new:completed.append(str(out))
                if len(completed)>=max_new:return completed
            except (OSError,ValueError) as exc:
                import logging
                logging.warning("Facebook square export skipped: %s",str(exc)[:130])
    return completed
