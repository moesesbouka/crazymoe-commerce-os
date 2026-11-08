"""Conservative, non-destructive product photo finishing.

Only approved *real* inventory photos from the selected Marketplace inbox can
be processed. Never alter originals, invent clean backgrounds, remove damage,
or process private barcode/model-only reference images.
"""
from __future__ import annotations
from pathlib import Path
from io import BytesIO
import hashlib
import os
import logging
import math
import cv2
import numpy as np
from PIL import Image, ImageOps, ImageEnhance, ImageFilter

PROJECT = Path.home() / "Documents" / "Moe-Marketplace-Workflow"
ORIGINALS = PROJECT / "Marketplace-Inbox" / "originals"
OUTPUT = PROJECT / "Prepared-Photos" / "enhanced"
VERSION = "v1-natural-20261027"
OUTPUT.mkdir(parents=True, exist_ok=True)

def output_path(sha):
    if len(sha)!=64 or any(c not in "0123456789abcdef" for c in sha):
        raise ValueError("Invalid photo hash")
    return OUTPUT / (sha+"-"+VERSION+".jpg")

def _crop_bounds(rgb):
    """GrabCut-derived conservative crop, never crop more than ~9% per edge."""
    h, w=rgb.shape[:2]
    scale=min(1., 650 / max(h,w))
    small=cv2.resize(rgb,(max(32,round(w*scale)),max(32,round(h*scale))),
                     interpolation=cv2.INTER_AREA)
    sh,sw=small.shape[:2]
    # GrabCut probable fg inside inset rectangle, using an actual product
    # photograph rather than a generated/segmented replacement background.
    margin=max(3,int(min(sw,sh)*.035))
    rect=(margin,margin,sw-2*margin,sh-2*margin)
    if min(rect[2:])<80:return (0,0,w,h),"insufficient_resolution"
    try:
        bg=np.zeros((1,65),np.float64)
        fg=np.zeros((1,65),np.float64)
        mask=np.zeros((sh,sw),np.uint8)
        cv2.grabCut(small,mask,rect,bg,fg,2,cv2.GC_INIT_WITH_RECT)
        fore=np.where((mask==cv2.GC_FGD)|(mask==cv2.GC_PR_FGD),1,0).astype(np.uint8)
        fore=cv2.morphologyEx(fore,cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
        ys,xs=np.where(fore>0)
        if len(xs)<.09*sw*sh or len(xs)>.83*sw*sh:
            return (0,0,w,h),"low_confidence"
        x0,x1=float(np.quantile(xs,.004))/sw,float(np.quantile(xs,.996))/sw
        y0,y1=float(np.quantile(ys,.004))/sh,float(np.quantile(ys,.996))/sh
        # Preserve loose accessories and shadows; protect every side.
        pad_x=.035;pad_y=.035
        left=min(.085,max(0,x0-pad_x)) if x0>.095 else 0
        right=min(.085,max(0,1-x1-pad_x)) if x1<.905 else 0
        top=min(.085,max(0,y0-pad_y)) if y0>.095 else 0
        bottom=min(.085,max(0,1-y1-pad_y)) if y1<.905 else 0
        bounds=(round(left*w),round(top*h),round((1-right)*w),round((1-bottom)*h))
        if bounds[2]-bounds[0]<.79*w or bounds[3]-bounds[1]<.79*h:
            return (0,0,w,h),"uncertain_crop"
        if sum(abs(v) for v in (bounds[0],bounds[1],w-bounds[2],h-bounds[3]))<.025*(w+h):
            return (0,0,w,h),"already_tight"
        return bounds,"conservative_subject_crop"
    except (cv2.error,ValueError):
        return (0,0,w,h),"segmentation_unavailable"

def finish_bytes(source,sha):
    source=Path(source)
    if source.resolve().parent!=ORIGINALS.resolve():
        raise ValueError("Only photos from the designated product originals folder")
    if hashlib.sha256(source.read_bytes()).hexdigest()!=sha:
        raise ValueError("Original hash mismatch: refusing processing")
    with Image.open(source) as image:
        image.load()
        im=ImageOps.exif_transpose(image).convert("RGB")
    if im.width*im.height>55_000_000:
        raise ValueError("Image too large")
    rgb=np.asarray(im)
    bounds,reason=_crop_bounds(rgb)
    cropped=im.crop(bounds)
    # Gentle auto-tone, never synthetic background or removed defects.
    stat=cv2.resize(rgb,(220,220),interpolation=cv2.INTER_AREA)
    y=cv2.cvtColor(stat,cv2.COLOR_RGB2LAB)[:,:,0]
    median=float(np.median(y))
    # L* median near 130-150 gives a natural warehouse exposure.
    exposure=max(.95,min(1.13,145. / max(100.,median)))
    cropped=ImageEnhance.Brightness(cropped).enhance(exposure)
    cropped=ImageEnhance.Contrast(cropped).enhance(1.035)
    cropped=cropped.filter(ImageFilter.UnsharpMask(radius=1.1,percent=85,threshold=3))
    b=BytesIO()
    cropped.save(b,"JPEG",quality=91,subsampling=0,optimize=True)
    details={"method":VERSION,"crop_reason":reason,"crop_xyxy":list(bounds),
             "original_size":[im.width,im.height],
             "finished_size":[cropped.width,cropped.height],
             "exposure":round(exposure,3),
             "edit_policy":"only framing, natural exposure, restrained sharpness; original retained"}
    return b.getvalue(),details

def process_one(sha,source):
    target=output_path(sha)
    if target.is_file() and target.stat().st_size>1000:
        return False,{"cached":True}
    payload,metadata=finish_bytes(source,sha)
    temp=target.with_suffix(".tmp")
    try:
        temp.write_bytes(payload)
        with Image.open(temp) as check:check.verify()
        temp.replace(target)
    finally:
        temp.unlink(missing_ok=True)
    return True,metadata

def process_pending(groups,photo_meta,max_new=3):
    """Bound work; only groups[].real_photos, never barcode/reference photos."""
    lookup={x["sha"]:Path(x["local_path"]) for x in photo_meta if x.get("local_path")}
    results=[]
    seen=set()
    # Every product gets an improved COVER early, before secondary angles.
    covers=[]
    secondary=[]
    for group in groups:
        real=group.get("real_photos",[])
        cover=group.get("cover","")
        covers.extend(p for p in real if p["sha"]==cover)
        secondary.extend(p for p in real if p["sha"]!=cover)
    for p in covers+secondary:
            sha=p["sha"]
            if sha in seen:continue
            seen.add(sha)
            if output_path(sha).exists():continue
            path=lookup.get(sha)
            if not path or not path.is_file():continue
            try:
                new,metadata=process_one(sha,path)
                if new: results.append({"sha":sha,"details":metadata})
            except Exception as exc:
                logging.warning("Photo finishing skipped %s: %s",sha[:12],str(exc)[:160])
            if len(results)>=max_new:return results
    return results
