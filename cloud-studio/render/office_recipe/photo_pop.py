"""Optional one-click, conservative 'Make It Pop' for approved buyer-visible square exports.
Never touches originals, masks, labels, source draft fields, or manufacturer pictures.
Input must be the existing (product-approved) 1600px Facebook-square JPEG.
"""
from pathlib import Path
import hashlib
from PIL import Image, ImageEnhance, ImageStat
from facebook_square_v2 import DEST

VERSION="cm-photo-pop-v1-20261029"

def dest_for(square):
    square=Path(square)
    if (not square.is_file() or square.parent.resolve()!=DEST.resolve()
            or square.suffix.lower()!=".jpg" or "-"+VERSION in square.name):
        raise ValueError("Only a validated, ordinary square export may be enhanced")
    st=square.stat()
    key=hashlib.sha256((str(square).casefold()+"|"+str(st.st_mtime_ns)+
                        "|"+str(st.st_size)+"|"+VERSION).encode()).hexdigest()
    return DEST/(key+"-"+VERSION+".jpg")

def ensure(square):
    src=Path(square)
    dst=dest_for(src)
    if dst.is_file() and dst.stat().st_size>5000:return dst,False
    with Image.open(src) as file:
        file.load()
        im=file.convert("RGB")
    if im.size!=(1600,1600):
        raise ValueError("Unexpected listing export dimensions")
    # Gentle and adaptive: no fake retouching, defect removal or generative changes.
    preview=im.resize((160,160))
    mean=ImageStat.Stat(preview.convert("L")).mean[0]
    boost=max(1.0,min(1.16,145.0/max(88.0,mean)))
    im=ImageEnhance.Brightness(im).enhance(boost)
    im=ImageEnhance.Contrast(im).enhance(1.055)
    im=ImageEnhance.Color(im).enhance(1.065)
    im=ImageEnhance.Sharpness(im).enhance(1.065)
    tmp=dst.with_suffix(".tmp")
    try:
        im.save(tmp,format="JPEG",quality=92,subsampling=0,optimize=True)
        with Image.open(tmp) as check:check.verify()
        tmp.replace(dst)
    finally:tmp.unlink(missing_ok=True)
    return dst,True
