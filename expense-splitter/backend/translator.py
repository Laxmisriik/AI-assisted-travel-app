"""
Language Translation Module
OCR:         EasyOCR (primary) -> pytesseract (fallback) -> Google Vision
Translation: deep-translator (free, no key) -> googletrans -> Google Cloud
"""

import os, base64, io, traceback
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from PIL import Image as PILImage

router = APIRouter(prefix="/translate", tags=["translator"])

LANGUAGES = {
    "auto": "Auto Detect", "en": "English", "ta": "Tamil", "hi": "Hindi",
    "ja": "Japanese", "zh": "Chinese", "ko": "Korean", "fr": "French",
    "de": "German", "es": "Spanish", "ar": "Arabic", "ru": "Russian",
    "pt": "Portuguese", "it": "Italian",
}

class TranslateTextRequest(BaseModel):
    text: str
    source_lang: Optional[str] = "auto"
    target_lang: Optional[str] = "en"

class TranslateImageRequest(BaseModel):
    image_base64: str
    source_lang: Optional[str] = "auto"
    target_lang: Optional[str] = "en"


def open_image(image_bytes: bytes) -> PILImage.Image:
    # try pillow-avif-plugin if available
    try:
        import pillow_avif  # noqa
    except ImportError:
        pass
    buf = io.BytesIO(image_bytes)
    img = PILImage.open(buf)
    img.load()
    return img.convert("RGB")


def preprocess_for_ocr(img: PILImage.Image) -> PILImage.Image:
    """Enhance image for better OCR accuracy."""
    # Resize if too small — Tesseract works best at 300+ DPI
    w, h = img.size
    if w < 1000:
        scale = 1000 / w
        img = img.resize((int(w * scale), int(h * scale)), PILImage.LANCZOS)

    # Convert to grayscale
    img = img.convert("L")

    # Increase contrast
    from PIL import ImageEnhance, ImageFilter
    img = ImageEnhance.Contrast(img).enhance(2.0)
    img = ImageEnhance.Sharpness(img).enhance(2.0)

    # Slight denoise
    img = img.filter(ImageFilter.MedianFilter(size=1))

    return img


def extract_text_from_image(image_bytes: bytes, source_lang: str = "auto") -> dict:
    errors = []

    # 1. Tesseract OCR (primary - install from https://github.com/UB-Mannheim/tesseract/wiki)
    try:
        import pytesseract
        for p in [
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
            "/usr/bin/tesseract", "/usr/local/bin/tesseract"
        ]:
            if os.path.exists(p):
                pytesseract.pytesseract.tesseract_cmd = p
                break
        img = preprocess_for_ocr(open_image(image_bytes))
        # use language-specific tessdata if available
        lang_map = {
            "ta": "tam", "hi": "hin", "ja": "jpn", "zh": "chi_sim",
            "ko": "kor", "fr": "fra", "de": "deu", "es": "spa",
            "ar": "ara", "ru": "rus", "en": "eng",
        }
        tess_lang = lang_map.get(source_lang, "eng") if source_lang not in ("auto","und") else "eng"
        # always include eng as fallback
        if tess_lang != "eng":
            tess_lang = f"{tess_lang}+eng"
        text = pytesseract.image_to_string(img, lang=tess_lang).strip()
        detected = source_lang if source_lang not in ("auto", "und") else "und"
        return {"text": text, "detected_lang": detected, "source": "tesseract"}
    except Exception as e:
        errors.append(f"Tesseract: {e}")

    # 2. EasyOCR (fallback - may not work on Python 3.13)
    try:
        import easyocr
        import numpy as np
        img = open_image(image_bytes)
        img_np = np.array(img)
        reader = easyocr.Reader(["en"], gpu=False, verbose=False)
        results = reader.readtext(img_np, detail=0, paragraph=True)
        text = "\n".join(results).strip()
        detected = source_lang if source_lang not in ("auto", "und") else "und"
        return {"text": text, "detected_lang": detected, "source": "easyocr"}
    except Exception as e:
        errors.append(f"EasyOCR: {e}")
    # 2. Tesseract
    try:
        import pytesseract
        for p in [
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
            "/usr/bin/tesseract", "/usr/local/bin/tesseract"
        ]:
            if os.path.exists(p):
                pytesseract.pytesseract.tesseract_cmd = p
                break
        img = open_image(image_bytes)
        text = pytesseract.image_to_string(img).strip()
        return {"text": text, "detected_lang": "und", "source": "tesseract"}
    except Exception as e:
        errors.append(f"Tesseract: {e}")

    # 3. Google Vision
    try:
        from google.cloud import vision
        client = vision.ImageAnnotatorClient()
        resp = client.text_detection(vision.Image(content=image_bytes))
        if resp.text_annotations:
            return {"text": resp.text_annotations[0].description.strip(),
                    "detected_lang": "und", "source": "google_vision"}
        return {"text": "", "detected_lang": "und", "source": "google_vision"}
    except Exception as e:
        errors.append(f"Google Vision: {e}")

    raise HTTPException(status_code=500, detail="OCR failed: " + " | ".join(errors))


def translate_text(text: str, source: str, target: str) -> dict:
    if not text.strip():
        return {"translated": "", "detected_lang": source, "source": "none"}

    errors = []

    # 1. deep-translator
    try:
        from deep_translator import GoogleTranslator
        src = "auto" if source in ("auto", "und") else source
        translated = GoogleTranslator(source=src, target=target).translate(text)
        return {"translated": translated, "detected_lang": source, "source": "deep_translator"}
    except Exception as e:
        errors.append(f"deep_translator: {e}")

    # 2. googletrans
    try:
        from googletrans import Translator
        t = Translator()
        src = "auto" if source in ("auto", "und") else source
        res = t.translate(text, src=src, dest=target)
        return {"translated": res.text, "detected_lang": res.src, "source": "googletrans"}
    except Exception as e:
        errors.append(f"googletrans: {e}")

    # 3. Google Cloud Translate
    try:
        from google.cloud import translate_v2 as gt
        client = gt.Client()
        src = None if source in ("auto", "und") else source
        result = client.translate(text, source_language=src, target_language=target)
        return {"translated": result["translatedText"],
                "detected_lang": result.get("detectedSourceLanguage", source),
                "source": "google_cloud"}
    except Exception as e:
        errors.append(f"Google Cloud: {e}")

    raise HTTPException(status_code=500, detail="Translation failed: " + " | ".join(errors))


@router.get("/languages")
def get_languages():
    return LANGUAGES


@router.get("/test-ocr")
def test_ocr():
    try:
        import easyocr
        easyocr.Reader(["en"], gpu=False, verbose=False)
        return {"status": "ok", "engine": "easyocr"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


@router.post("/text")
def translate_text_route(body: TranslateTextRequest):
    try:
        result = translate_text(body.text, body.source_lang, body.target_lang)
        return {"original": body.text, "translated": result["translated"],
                "detected_lang": result["detected_lang"], "target_lang": body.target_lang,
                "engine": result["source"]}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/image")
async def translate_image_route(body: TranslateImageRequest):
    try:
        b64 = body.image_base64.strip()
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        b64 += "=" * (-len(b64) % 4)
        image_bytes = base64.b64decode(b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64: {e}")

    try:
        ocr = extract_text_from_image(image_bytes, body.source_lang)
        if not ocr["text"]:
            return {"original": "", "translated": "", "detected_lang": "und",
                    "target_lang": body.target_lang, "ocr_engine": ocr["source"],
                    "message": "No text detected in image"}

        source = ocr["detected_lang"] if body.source_lang == "auto" else body.source_lang
        trans = translate_text(ocr["text"], source, body.target_lang)

        return {"original": ocr["text"], "translated": trans["translated"],
                "detected_lang": trans["detected_lang"], "target_lang": body.target_lang,
                "ocr_engine": ocr["source"], "trans_engine": trans["source"]}

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))