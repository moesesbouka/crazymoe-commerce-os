"""Existing office rendering algorithms, with byte inputs and deterministic jobs.

No filesystem, network, seller-field writes or automatic publication.
Original recipe constants and confidence fallbacks are preserved.
"""
from io import BytesIO
import hashlib
import threading
import warnings
import cv2
import numpy as np
from PIL import Image, ImageOps, ImageEnhance, ImageFilter, ImageDraw, ImageFont, ImageChops, ImageStat

RECIPE = "existing-finish-v4-pop-v1-cloud1"
_LOCK = threading.Lock()

def _jpeg(im, quality=91):
    output = BytesIO()
    im.save(output, "JPEG", quality=quality, subsampling=0, optimize=True)
    return output.getvalue()

def _decode(payload):
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(BytesIO(payload)) as source:
            if source.format not in ("JPEG", "PNG", "WEBP"):
                raise ValueError("Unsupported source format")
            if source.width * source.height > 55_000_000 or min(source.size) < 100:
                raise ValueError("Image resolution unsuitable")
            source.load()
            return ImageOps.exif_transpose(source).convert("RGB")

def render(payload, expected_sha, *, kind="real", style="natural", pop=False,
           focus=None, focus_reviewed=False):
    """Render an already-authorized source; caller must validate inventory membership.

    The cloud job must separately compare listing and photo revisions before
    registering these bytes. Never substitute this result for a migrated export.
    """
    if not isinstance(payload, bytes) or not 1 <= len(payload) <= 16_000_000:
        raise ValueError("Source size unsuitable")
    if hashlib.sha256(payload).hexdigest() != expected_sha:
        raise ValueError("Original hash mismatch")
    if kind not in ("real", "manufacturer") or style not in ("natural", "blur", "brand"):
        raise ValueError("Invalid source kind or style")
    if type(pop) is not bool or (kind == "manufacturer" and (style != "natural" or pop or focus is not None)):
        raise ValueError("Manufacturer photos cannot receive inventory enhancements")
    if focus is not None:
        if not focus_reviewed or not isinstance(focus,(list,tuple)) or len(focus)!=4:
            raise ValueError("Focus crop needs source-specific review")
        l,t,r,b = map(float,focus)
        if not (0<=l<r<=1 and 0<=t<b<=1 and r-l>=.55 and b-t>=.92):
            raise ValueError("Unsafe focus crop")
    # GrabCut uses process-global RNG. Serialize and seed it so retries agree.
    with _LOCK:
        cv2.setNumThreads(1)
        cv2.setRNGSeed(0)
        im = _decode(payload)
        info = {"recipe":RECIPE,"source_sha":expected_sha,"kind":kind,
                "requested_style":style,"actual_style":"natural","pop":pop}
        if kind == "real":
            rgb=np.asarray(im)
            bounds,reason=_crop_bounds(rgb)
            stat=cv2.resize(rgb,(220,220),interpolation=cv2.INTER_AREA)
            median=float(np.median(cv2.cvtColor(stat,cv2.COLOR_RGB2LAB)[:,:,0]))
            exposure=max(.95,min(1.13,145./max(100.,median)))
            im=ImageEnhance.Brightness(im.crop(bounds)).enhance(exposure)
            im=ImageEnhance.Contrast(im).enhance(1.035)
            im=im.filter(ImageFilter.UnsharpMask(radius=1.1,percent=85,threshold=3))
            # Preserve the office recipe's intermediate JPEG encode/decode.
            im=_decode(_jpeg(im))
            info.update(crop_xyxy=list(bounds),crop_reason=reason,exposure=round(exposure,3))
            if style != "natural":
                natural=im
                im=im.copy()
                if max(im.size)>1650: im.thumbnail((1650,1650),Image.Resampling.LANCZOS)
                alpha,confidence,reason=_safe_subject_mask(np.asarray(im))
                info.update(style_confidence=round(confidence,3),style_reason=reason)
                if alpha is not None:
                    radius=max(3.,min(6.3,min(im.size)*.0048))
                    subdued=Image.blend(im,im.filter(ImageFilter.GaussianBlur(radius)),.66)
                    subdued=ImageEnhance.Color(subdued).enhance(.965)
                    im=Image.composite(im,subdued,alpha)
                    info['actual_style']='blur'
                    if style == 'brand' and confidence>=.63:
                        im=Image.alpha_composite(im.convert('RGBA'),_wordmark(im.size,alpha)).convert('RGB')
                        info['actual_style']='brand'
                    im=_decode(_jpeg(im))
                else:
                    im=natural
        selected=im
        if focus is not None:
            box=(round(l*im.width),round(t*im.height),round(r*im.width),round(b*im.height))
            if box[2]-box[0]<.55*im.width or box[3]-box[1]<.92*im.height:
                raise ValueError('Rounded focus crop unsafe')
            selected=im.crop(box)
        size=(1600,1600)
        bg=ImageOps.fit(selected,size,method=Image.Resampling.BILINEAR)
        bg=bg.filter(ImageFilter.GaussianBlur(radius=96))
        bg=ImageEnhance.Color(bg).enhance(.38)
        bg=ImageEnhance.Contrast(bg).enhance(.58)
        bg=Image.blend(bg,Image.new('RGB',size,(241,243,246)),.76)
        fg=selected.copy();fg.thumbnail((1500,1500),Image.Resampling.LANCZOS)
        mask=Image.new('L',fg.size,255)
        if min(fg.size)>70:
            ImageDraw.Draw(mask).rectangle((0,0,fg.width-1,fg.height-1),outline=132,width=6)
            mask=mask.filter(ImageFilter.GaussianBlur(radius=5))
        bg.paste(fg,((1600-fg.width)//2,(1600-fg.height)//2),mask)
        result=_jpeg(bg)
        if pop:
            im=_decode(result)
            mean=ImageStat.Stat(im.resize((160,160)).convert('L')).mean[0]
            im=ImageEnhance.Brightness(im).enhance(max(1.,min(1.16,145./max(88.,mean))))
            im=ImageEnhance.Contrast(im).enhance(1.055)
            im=ImageEnhance.Color(im).enhance(1.065)
            im=ImageEnhance.Sharpness(im).enhance(1.065)
            result=_jpeg(im,92)
        info.update(sha256=hashlib.sha256(result).hexdigest(),bytes=len(result),width=1600,height=1600,
                    focal_crop=focus,original_untouched=True)
        return result,info

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

def _safe_subject_mask(rgb):
    mask,conf,reason=_mask_and_score(rgb)
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

