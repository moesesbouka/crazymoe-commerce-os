"""Crazy Moe Marketplace: premium, natural, non-destructive background finish v4.
Safer than hard cutout. Deliberately mild photographic depth of field.
Never change original inventory photographs or private ID/UPC photos.
"""
from __future__ import annotations
from pathlib import Path
import json, logging
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw, ImageFont, ImageOps, ImageChops
import numpy as np
import cv2
import background_finish as old

ROOT=old.ROOT
SOURCE=old.SOURCE
OUTPUT=old.OUTPUT
VERSION="v4-premium-20261027"

def target(sha,kind):
    if not isinstance(sha,str) or len(sha)!=64 or any(c not in "0123456789abcdef" for c in sha):
        raise ValueError("Invalid real photo hash")
    if kind not in ("blur","brand"):raise ValueError("Invalid mode")
    return OUTPUT/(sha+"-"+kind+"-"+VERSION+".jpg")
def meta_path(sha):
    target(sha,"blur")
    return OUTPUT/(sha+"-"+VERSION+".json")
def metadata(sha):
    try:return json.loads(meta_path(sha).read_text(encoding="utf-8"))
    except (OSError,ValueError):return {}

def _safe_subject_mask(rgb):
    mask,conf,reason=old._mask_and_score(rgb)
    if mask is None or conf<.43:return None,conf,reason
    # Maintain a generous crisp buffer around thin product contours, wires,
    # feet, caster wheels and small accessories. Soft fade outside buffer.
    h,w=mask.shape
    pad=max(7,int(min(h,w)*.013))
    binary=np.where(mask>=96,255,0).astype(np.uint8)
    kernel=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(2*pad+1,2*pad+1))
    grown=cv2.dilate(binary,kernel,iterations=1)
    alpha=Image.fromarray(grown,mode="L").filter(ImageFilter.GaussianBlur(radius=max(2,pad*.5)))
    return alpha,conf,reason

def _wordmark(size,foreground,phrase="Crazy Moe's"):
    """A faint backdrop wordmark; never overlays recognized product pixels."""
    w,h=size
    layer=Image.new("RGBA",(w,h),(0,0,0,0))
    try:font=ImageFont.truetype("arialbd.ttf",max(20,int(w*.045)))
    except OSError:
        try:font=ImageFont.truetype("DejaVuSans-Bold.ttf",max(20,int(w*.045)))
        except OSError:font=ImageFont.load_default()
    draw=ImageDraw.Draw(layer)
    # restrained photography backdrop signature, not a loud central watermark
    anchor_x=int(w*.075)
    anchor_y=int(h*.095)
    draw.text((anchor_x,anchor_y),phrase,font=font,fill=(35,64,108,58),stroke_width=0)
    # Secondary tiny echo in opposing negative space, lower opacity.
    small=max(16,int(w*.023))
    try:font2=ImageFont.truetype("arial.ttf",small)
    except OSError:font2=ImageFont.load_default()
    draw.text((int(w*.66),int(h*.88)),phrase,font=font2,fill=(35,64,108,27))
    inv=ImageOps.invert(foreground.filter(ImageFilter.GaussianBlur(5)))
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"),inv))
    return layer

def process(sha,source=None):
    source=Path(source) if source else None
    if not source or source.resolve().parent!=SOURCE.resolve() or not source.is_file():
        raise ValueError("Only existing natural-enhanced photos in designated folder may be styled")
    if source.name!=(sha+"-v1-natural-20261027.jpg"):
        raise ValueError("Derived input hash mismatch")
    if all(target(sha,k).is_file() for k in ("blur","brand")) and meta_path(sha).is_file():
        return False,metadata(sha)
    with Image.open(source) as o:
        o.load()
        im=ImageOps.exif_transpose(o).convert("RGB")
    maxedge=1650
    if max(im.size)>maxedge:
        im.thumbnail((maxedge,maxedge),Image.Resampling.LANCZOS)
    alpha,conf,reason=_safe_subject_mask(np.asarray(im))
    if alpha is None:
        blur=im.copy();brand=im.copy()
        modes={"blur":"natural_fallback","brand":"natural_fallback"}
    else:
        # Reduced radius and blend avoid foggy/melted appearance.
        radius=max(3.0,min(6.3,min(im.size)*.0048))
        fully=im.filter(ImageFilter.GaussianBlur(radius))
        # 66% of the mild blur is enough to simplify warehouse clutter.
        subdued=Image.blend(im,fully,.66)
        subdued=ImageEnhance.Color(subdued).enhance(.965)
        blur=Image.composite(im,subdued,alpha)
        modes={"blur":"premium_soft_blur"}
        if conf>=.63:
            brand=Image.alpha_composite(blur.convert("RGBA"),_wordmark(im.size,alpha)).convert("RGB")
            modes["brand"]="faint_brand_behind_subject"
        else:
            brand=blur.copy();modes["brand"]="blur_fallback_no_brand"
    info={"method":VERSION,"source_sha":sha,"confidence":round(conf,3),
          "reason":reason,"applied":modes,"original_inventory_photo_untouched":True,
          "quality_policy":"soft blur only; guarded edges and accessories; faint branding behind subject; natural fallback"}
    for kind,imout in (("blur",blur),("brand",brand)):
        dst=target(sha,kind);temporary=dst.with_suffix(".tmp")
        try:
            imout.save(temporary,format="JPEG",quality=91,subsampling=0,optimize=True)
            with Image.open(temporary) as check:check.verify()
            temporary.replace(dst)
        finally:
            temporary.unlink(missing_ok=True)
    temp=meta_path(sha).with_suffix(".tmp")
    try:
        temp.write_text(json.dumps(info,indent=2)+"\n",encoding="utf-8")
        temp.replace(meta_path(sha))
    finally:temp.unlink(missing_ok=True)
    return True,info

def actual_mode(sha,preference,cover=False):
    if preference=="natural":return "natural"
    m=metadata(sha)
    if not m or not all(target(sha,k).is_file() for k in ("blur","brand")):return "natural"
    applied=m.get("applied",{})
    if preference=="blur":return "blur" if applied.get("blur")=="premium_soft_blur" else "natural"
    if preference=="brand":
        if applied.get("brand")=="faint_brand_behind_subject":return "brand"
        return "blur" if applied.get("blur")=="premium_soft_blur" else "natural"
    # Premium Auto: milder blur for hero covers, natural on secondary detail photos.
    # Branded background remains an explicit seller choice, not forced.
    return actual_mode(sha,"blur" if cover else "natural",cover)

def path_for(sha,preference,cover=False):
    mode=actual_mode(sha,preference,cover)
    return target(sha,mode) if mode in ("blur","brand") else None

def pending(groups,max_new=3):
    ordered=[]
    for g in groups:ordered.extend(p for p in g.get("real_photos",[]) if p["sha"]==g.get("cover"))
    for g in groups:ordered.extend(p for p in g.get("real_photos",[]) if p["sha"]!=g.get("cover"))
    done=set();out=[]
    for p in ordered:
        sha=p["sha"]
        if sha in done:continue
        done.add(sha)
        if meta_path(sha).is_file() and all(target(sha,k).is_file() for k in ("blur","brand")):continue
        source=SOURCE/(sha+"-v1-natural-20261027.jpg")
        if not source.is_file():continue
        try:
            new,info=process(sha,source)
            if new:out.append((sha,info["confidence"],info["applied"]["brand"]))
        except Exception as e:logging.warning("Safe photo backdrop skipped %s: %s",sha[:12],str(e)[:160])
        if len(out)>=max_new:break
    return out
