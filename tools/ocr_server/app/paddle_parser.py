from __future__ import annotations

import asyncio
from io import BytesIO

import numpy as np
from PIL import Image

from .schemas import OcrElement, ParsedPage, ParsedResult
from .groq_extractor import extract_fields_with_groq
from .layout import serialize_layout

_ocr = None
_lock = asyncio.Lock()


def _get_ocr():
    global _ocr
    if _ocr is None:
        from paddleocr import PaddleOCR

        _ocr = PaddleOCR(
            use_doc_orientation_classify=False,
            use_doc_unwarping=True,
            lang="ch",
        )
    return _ocr


def _pil_to_numpy(image: Image.Image) -> np.ndarray:
    if image.mode != "RGB":
        image = image.convert("RGB")
    return np.array(image)


def _safe_len(x) -> int:
    if x is None:
        return 0
    try:
        return int(x.shape[0])
    except Exception:
        pass
    try:
        return len(x)
    except Exception:
        return 0


def _has_items(x) -> bool:
    return _safe_len(x) > 0


def _to_list(x):
    if x is None:
        return []
    if hasattr(x, "tolist"):
        return x.tolist()
    if isinstance(x, (list, tuple)):
        return list(x)
    return [x]


def _page_to_dict(page):
    if hasattr(page, "to_dict"):
        try:
            d = page.to_dict()
            if isinstance(d, dict):
                return d
        except Exception:
            pass

    if hasattr(page, "json"):
        try:
            j = page.json()
            if isinstance(j, dict):
                return j
            if isinstance(j, str):
                import json as _json

                return _json.loads(j)
        except Exception:
            pass

    if isinstance(page, dict):
        return page

    out = {}
    for k in ("rec_boxes", "rec_texts", "rec_scores", "dt_polys", "rec_polys", "input_path", "page_index"):
        if hasattr(page, k):
            out[k] = getattr(page, k)
    return out


def _debug_result_shape(result):
    try:
        print("PaddleOCR result type:", type(result))
        if isinstance(result, list) and result:
            r0 = result[0]
            print("PaddleOCR result[0] type:", type(r0))
            if isinstance(r0, list) and _has_items(r0):
                print("PaddleOCR result[0] is list, len:", _safe_len(r0))
                print("PaddleOCR result[0][0] type:", type(r0[0]))
            d = _page_to_dict(r0)
            print("PaddleOCR result[0] page_keys:", sorted(str(k) for k in d.keys()))

            rec_texts = d.get("rec_texts")
            rec_boxes = d.get("rec_boxes")
            dt_polys = d.get("dt_polys")
            rec_polys = d.get("rec_polys")
            rec_scores = d.get("rec_scores")

            print(
                "PaddleOCR counts =>"
                f" rec_texts={_safe_len(rec_texts)}"
                f" rec_boxes={_safe_len(rec_boxes)}"
                f" dt_polys={_safe_len(dt_polys)}"
                f" rec_polys={_safe_len(rec_polys)}"
                f" rec_scores={_safe_len(rec_scores)}"
            )

            if _has_items(rec_texts):
                try:
                    preview = _to_list(rec_texts)[:3]
                    print("PaddleOCR first 3 texts:", preview)
                except Exception:
                    pass
    except Exception as e:
        print("PaddleOCR debug print failed:", e)


def _v2_list_parse(result, img_width, img_height):
    elements = []
    if not result or not result[0]:
        return elements

    for item in result[0]:
        try:
            bbox_points = item[0]
            text = item[1][0] if isinstance(item[1], (list, tuple)) else item[1]
            confidence = item[1][1] if isinstance(item[1], (list, tuple)) and len(item[1]) > 1 else 1.0

            x1 = int(min(p[0] for p in bbox_points))
            y1 = int(min(p[1] for p in bbox_points))
            x2 = int(max(p[0] for p in bbox_points))
            y2 = int(max(p[1] for p in bbox_points))

            x1 = max(0, x1)
            y1 = max(0, y1)
            x2 = min(img_width, x2)
            y2 = min(img_height, y2)

            if x2 <= x1 or y2 <= y1:
                continue

            elements.append(OcrElement(
                type="text",
                text=str(text).strip(),
                bbox=[x1, y1, x2, y2],
                confidence=float(confidence),
            ))
        except (TypeError, ValueError, IndexError):
            continue

    return elements


def _polys_to_bboxes(polys):
    """Convert Nx4x2 quad polygons to Nx4 bounding boxes [xmin,ymin,xmax,ymax]."""
    bboxes = []
    for poly in polys:
        try:
            row = poly
            if hasattr(poly, "tolist"):
                row = poly.tolist()
            if len(row) >= 4:
                xs = [p[0] for p in row]
                ys = [p[1] for p in row]
                bboxes.append([int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))])
            else:
                bboxes.append([0, 0, 0, 0])
        except Exception:
            bboxes.append([0, 0, 0, 0])
    return bboxes


def _v3_dict_parse(page_dict, img_width, img_height):
    elements = []

    rec_boxes = page_dict.get("rec_boxes")
    rec_texts = page_dict.get("rec_texts") or page_dict.get("rec_text")
    rec_scores = page_dict.get("rec_scores") or page_dict.get("rec_score")
    dt_polys = page_dict.get("dt_polys")
    rec_polys = page_dict.get("rec_polys")

    if _has_items(rec_boxes):
        boxes = _to_list(rec_boxes)
    elif _has_items(dt_polys):
        boxes = _polys_to_bboxes(dt_polys)
    elif _has_items(rec_polys):
        boxes = _polys_to_bboxes(rec_polys)
    else:
        return elements

    texts = _to_list(rec_texts) if _has_items(rec_texts) else []
    scores = _to_list(rec_scores) if _has_items(rec_scores) else []

    n_texts = _safe_len(texts) or _safe_len(boxes)
    n_scores = _safe_len(scores) or _safe_len(boxes)
    n = min(_safe_len(boxes), n_texts, n_scores)

    for i in range(n):
        try:
            box = boxes[i]
            if not isinstance(box, (list, tuple)) or len(box) < 4:
                continue

            x1 = int(box[0])
            y1 = int(box[1])
            x2 = int(box[2])
            y2 = int(box[3])

            x1 = max(0, x1)
            y1 = max(0, y1)
            x2 = min(img_width, x2)
            y2 = min(img_height, y2)

            if x2 <= x1 or y2 <= y1:
                continue

            text = str(texts[i]).strip() if i < len(texts) else ""
            confidence = float(scores[i]) if i < len(scores) else 1.0

            elements.append(OcrElement(
                type="text",
                text=text,
                bbox=[x1, y1, x2, y2],
                confidence=confidence,
            ))
        except (TypeError, ValueError, IndexError):
            continue

    return elements


_V3_KEYS = {"rec_boxes", "dt_polys", "rec_polys"}


def _ocr_result_to_elements(result, img_width, img_height):
    if not result:
        return []

    if isinstance(result, list) and result:
        d = _page_to_dict(result[0])
        if _V3_KEYS & set(d.keys()):
            return _v3_dict_parse(d, img_width, img_height)

    return _v2_list_parse(result, img_width, img_height)


async def _parse_single_image(image_bytes: bytes, photo_index: int = 0) -> tuple[ParsedPage, str, int, int]:
    """Run OCR on a single image and return (page, layout_text, width, height).

    Acquires the global PaddleOCR lock internally.
    """
    async with _lock:
        ocr = _get_ocr()

        image = Image.open(BytesIO(image_bytes))
        img_width, img_height = image.size
        np_image = _pil_to_numpy(image)

        result = ocr.ocr(np_image)

        _debug_result_shape(result)

        elements = _ocr_result_to_elements(result, img_width, img_height)

        elements = [el for el in elements if el.confidence >= 0.75]

        for el in elements:
            el.photo_index = photo_index

        raw_text = "\n".join(el.text for el in elements)
        layout_text = serialize_layout(elements, img_width)

        page = ParsedPage(
            width=img_width,
            height=img_height,
            elements=elements,
        )

        return page, raw_text, layout_text, img_width


async def parse_image_bytes(image_bytes: bytes) -> ParsedResult:
    page, _, layout_text, img_width = await _parse_single_image(image_bytes, photo_index=0)

    case_fields = None
    extraction_engine = "none"
    extraction_fallback = False

    try:
        case_fields = await extract_fields_with_groq(layout_text)
        if case_fields is not None:
            extraction_engine = "llm"
        else:
            extraction_fallback = True
    except Exception as exc:
        print("[Groq] Unexpected error in field extraction:", exc)
        extraction_fallback = True

    return ParsedResult(
        engine="paddleocr-ppstructurev3",
        version="v1",
        pages=[page],
        case_fields=case_fields,
        extraction_engine=extraction_engine,
        extraction_fallback=extraction_fallback,
        photo_count=1,
    )


async def parse_multi_image_bytes(images_bytes: list[bytes]) -> ParsedResult:
    """Parse multiple images and combine into a single ParsedResult.

    Each image is OCR'd independently. Layout texts are combined with
    photo headers so the LLM sees all photos' content in one request.
    Returns a single set of case_fields extracted from the combined layout.
    """
    pages: list[ParsedPage] = []
    combined_layout_parts: list[str] = []

    for i, image_bytes in enumerate(images_bytes):
        page, _, layout_text, _ = await _parse_single_image(image_bytes, photo_index=i)
        pages.append(page)
        if layout_text.strip():
            header = f"--- Photo {i + 1} ---"
            combined_layout_parts.append(f"{header}\n{layout_text}")

    combined_layout = "\n\n".join(combined_layout_parts) if combined_layout_parts else ""

    case_fields = None
    extraction_engine = "none"
    extraction_fallback = False

    if combined_layout.strip():
        try:
            case_fields = await extract_fields_with_groq(combined_layout)
            if case_fields is not None:
                extraction_engine = "llm"
            else:
                extraction_fallback = True
        except Exception as exc:
            print("[Groq] Unexpected error in field extraction:", exc)
            extraction_fallback = True

    return ParsedResult(
        engine="paddleocr-ppstructurev3",
        version="v1",
        pages=pages,
        case_fields=case_fields,
        extraction_engine=extraction_engine,
        extraction_fallback=extraction_fallback,
        photo_count=len(images_bytes),
    )
