"""Derived-only, natural-looking product background treatments.
No edits to inventory originals or private identification images.
"""
from __future__ import annotations
from pathlib import Path
from io import BytesIO
import hashlib, json, math, os
import cv2, numpy as np
from PIL import Image, ImageOps, ImageDraw, ImageFont, ImageFilter, ImageEnhance

ROOT=Path.home()/"Documents"/"Moe-Marketplace-Workflow"
SOURCE=ROOT/"Prepared-Photos"/"enhanced"
OUTPUT=ROOT/"Prepared-Photos"/"styled"
VERSION="v3-bg-20261027"
OUTPUT.mkdir(parents=True,exist_ok=True)

def target(sha,kind):
    if len(sha)!=64 or any(c not in "0123456789abcdef" for c in sha):
        raise ValueError("Invalid real-photo SHA")
    if kind not in ("blur","brand"):
        raise ValueError("Invalid background finish")
    return OUTPUT/(sha+"-"+kind+"-"+VERSION+".jpg")

def meta_path(sha):
    if len(sha)!=64 or any(c not in "0123456789abcdef" for c in sha):raise ValueError("bad hash")
    return OUTPUT/(sha+"-"+VERSION+".json")

def metadata(sha):
    try:return json.loads(meta_path(sha).read_text(encoding="utf-8"))
    except (OSError,ValueError):return {}

def _mask_and_score(rgb):
    """Foreground estimate at low resolution, conservative confidence gate."""
    h,w=rgb.shape[:2]
    sw=max(100,round(w*min(1.,600/max(h,w))))
    sh=max(100,round(h*min(1.,600/max(h,w))))
    tiny=cv2.resize(rgb,(sw,sh),interpolation=cv2.INTER_AREA)
    margin=max(9,round(min(sw,sh)*.045))
    rect=(margin,margin,sw-margin*2,sh-margin*2)
    mark=np.zeros((sh,sw),np.uint8)
    b=np.zeros((1,65),np.float64); f=np.zeros((1,65),np.float64)
    try:cv2.grabCut(tiny,mark,rect,b,f,2,cv2.GC_INIT_WITH_RECT)
    except cv2.error:return None,0.0,"segmentation_error"
    foreground=np.isin(mark,(cv2.GC_FGD,cv2.GC_PR_FGD)).astype(np.uint8)*255
    foreground=cv2.morphologyEx(foreground,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
    ys,xs=np.nonzero(foreground)
    if len(xs)<.065*sw*sh or len(xs)>.86*sw*sh:
        return None,0.0,"foreground_fraction_unreliable"
    cc,lab,stats,_=cv2.connectedComponentsWithStats(foreground,8)
    if cc<=1:return None,0.0,"no_foreground"
    order=sorted(stats[1:,cv2.CC_STAT_AREA].tolist(),reverse=True)
    portion=order[0]/max(1,sum(order))
    # Plenty of loose parts, cords, tools -> avoid aggressive hard cutout.
    xlo,xhi=xs.min()/sw,xs.max()/sw
    ylo,yhi=ys.min()/sh,ys.max()/sh
    touches=any((xlo<.055,ylo<.055,xhi>.945,yhi>.945))
    occ=len(xs)/(sw*sh)
    confidence=.78
    if portion<.75:confidence-=.24
    elif portion<.9:confidence-=.12
    if touches:confidence-=.12
    if occ<.13 or occ>.7:confidence-=.09
    # Image variation at edges: very cluttered backgrounds are harder to mask.
    border=np.concatenate((tiny[:20,:,:].reshape(-1,3),tiny[-20:,:,:].reshape(-1,3),
                           tiny[:,:20,:].reshape(-1,3),tiny[:,-20:,:].reshape(-1,3)),axis=0)
    if float(border.std(axis=0).mean())>64:confidence-=.1
    confidence=max(.05,min(.82,confidence))
    # Dilate to protect wires/fine contours, then lightly feather.
    dilate=np.ones((7,7),np.uint8)
    foreground=cv2.dilate(foreground,dilate,iterations=1)
    return cv2.resize(foreground,(w,h),interpolation=cv2.INTER_LINEAR),confidence,f"largest_component={portion:.2f};occupancy={occ:.2f};touches_edge={touches}"

def _brand_layer(size,foreground=None):
    w,h=size
    layer=Image.new("RGBA",(w,h),(0,0,0,0))
    draw=ImageDraw.Draw(layer)
    try:font=ImageFont.truetype("arialbd.ttf",max(24,round(min(w,h)*.044)))
    except OSError:
        try:font=ImageFont.truetype("DejaVuSans-Bold.ttf",max(24,round(min(w,h)*.044)))
        except OSError:font=ImageFont.load_default()
    phrase="Crazy Moe's"
    # Behind the subject only, intentionally almost invisible.
    for row,y in enumerate(range(-h//8,h+h//8,max(150,h//4))):
        for x in range((-w//7 if row%2 else w//11),w+w//5,max(240,w//2)):
            draw.text((x,y),phrase,fill=(62,87,125,35),font=font)
    if foreground is not None:
        alpha=layer.getchannel("A")
        inv=ImageOps.invert(foreground.filter(ImageFilter.GaussianBlur(5)))
        from PIL import ImageChops
        layer.putalpha(ImageChops.multiply(alpha,inv))
    return layer

def process(sha,source=None):
    source=Path(source) if source else None
    # Only pre-existing, provenance-checked natural copies may be styled.
    if source is None or source.resolve().parent!=SOURCE.resolve() or not source.is_file() or sha not in source.name:
        raise ValueError("Input must be a verified natural finished real product photo")
    if all(target(sha,k).exists() for k in ("blur","brand")) and meta_path(sha).is_file():
        return False,metadata(sha)
    with Image.open(source) as original:
        original.load()
        im=ImageOps.exif_transpose(original).convert("RGB")
    max_edge=1650
    if max(im.size)>max_edge:
        im.thumbnail((max_edge,max_edge),Image.Resampling.LANCZOS)
    rgb=np.asarray(im)
    mask,score,reason=_mask_and_score(rgb)
    # Never apply inaccurate background removal to cluttered photos.
    if mask is None or score<.43:
        mask=None
    if mask is not None:
        fg=Image.fromarray(mask,"L").filter(ImageFilter.GaussianBlur(2.5))
        blurred=im.filter(ImageFilter.GaussianBlur(max(10,round(min(im.size)*.017))))
        blurred=ImageEnhance.Color(blurred).enhance(.9)
        blur=Image.composite(im,blurred,fg)
    else:
        blur=im.copy()
    # Light branding only BEHIND recognized subject, never stamped on equipment.
    if mask is not None and score>=.63:
        branded=Image.alpha_composite(blur.convert("RGBA"),_brand_layer(im.size,fg)).convert("RGB")
        modes={"blur":"blurred_background","brand":"subtle_brand_behind_product"}
    elif mask is not None:
        branded=blur.copy()
        modes={"blur":"blurred_background","brand":"blur_fallback_no_brand"}
    else:
        branded=im.copy()
        modes={"blur":"natural_fallback","brand":"natural_fallback"}
    record={"method":VERSION,"confidence":round(score,3),"reason":reason,"applied":modes,
            "source_sha":sha,"original_inventory_photo_untouched":True,
            "policy":"No product/background invented. Fallback to natural on uncertain masking."}
    for kind,result in (("blur",blur),("brand",branded)):
        p=target(sha,kind);tmp=p.with_suffix(".tmp")
        try:
            result.save(tmp,format="JPEG",quality=89,subsampling=0,optimize=True)
            with Image.open(tmp) as verify:verify.verify()
            tmp.replace(p)
        finally:tmp.unlink(missing_ok=True)
    tmp=meta_path(sha).with_suffix(".tmp")
    tmp.write_text(json.dumps(record,indent=2),encoding="utf-8")
    tmp.replace(meta_path(sha))
    return True,record

def actual_mode(sha,preference,cover=False):
    """Source-of-truth for safe listing style, never assert cutout where not verified."""
    if preference=="natural":return "natural"
    m=metadata(sha)
    if not m or not all(target(sha,k).is_file() for k in ("blur","brand")):
        return "natural"
    if preference=="blur":return "blur" if m["applied"]["blur"]!="natural_fallback" else "natural"
    if preference=="brand":
        return "brand" if m["applied"]["brand"]=="subtle_brand_behind_product" else ("blur" if m["applied"]["blur"]=="blurred_background" else "natural")
    # Auto: branded for cover when safe, blur for all other photos.
    return actual_mode(sha,"brand" if cover else "blur",cover)

def path_for(sha,preference,cover=False):
    mode=actual_mode(sha,preference,cover)
    return target(sha,mode) if mode in ("blur","brand") else None

def pending(groups,max_new=4):
    # Natural baseline already selected as real_photos, excludes model/barcode labels.
    result=[]
    ordered=[]
    for g in groups:
        ordered.extend(x for x in g.get("real_photos",[]) if x["sha"]==g.get("cover"))
    for g in groups:
        ordered.extend(x for x in g.get("real_photos",[]) if x["sha"]!=g.get("cover"))
    seen=set()
    for p in ordered:
        sha=p["sha"]
        if sha in seen:continue
        seen.add(sha)
        if meta_path(sha).exists() and all(target(sha,k).exists() for k in ("blur","brand")):continue
        source=SOURCE/(sha+"-v1-natural-20261027.jpg")
        if not source.exists():continue
        try:
            updated,info=process(sha,source)
            if updated:result.append((sha,info["confidence"],info["applied"]["brand"]))
        except Exception as e:
            import logging
            logging.warning("Background finish skipped %s: %s",sha[:12],str(e)[:180])
        if len(result)>=max_new:break
    return result
