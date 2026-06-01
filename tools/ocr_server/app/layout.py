from __future__ import annotations

from statistics import median
from typing import List

from .schemas import OcrElement


def _is_noise(el: OcrElement) -> bool:
    """Drop QR codes and icon labels (mirrors mobile isQrCodeElement heuristic)."""
    text = el.text.strip()
    if len(text) > 2:
        return False

    x1, y1, x2, y2 = el.bbox
    w = x2 - x1
    h = y2 - y1

    if w < 40 or h < 40:
        return False

    aspect = w / h
    if aspect < 0.7 or aspect > 1.4:
        return False

    return True


def serialize_layout(elements: List[OcrElement], page_width: int) -> str:
    """Build a layout-preserving serialization from OCR elements.

    Each output line is one visual row.  Within a row, cells are separated
    by ``" | "`` when the horizontal gap exceeds a width-relative threshold,
    preserving left/right column structure for the LLM.
    """
    els = [e for e in elements if not _is_noise(e)]
    if not els:
        return ""

    # Sort by vertical center
    els.sort(key=lambda e: (e.bbox[1] + e.bbox[3]) / 2)

    # Resolution-independent row tolerance: 0.6 × median text height
    heights = [e.bbox[3] - e.bbox[1] for e in els]
    median_h = median(heights) if heights else 1
    row_tol = 0.6 * median_h

    # Cluster into rows
    rows: list[dict] = []
    for e in els:
        cy = (e.bbox[1] + e.bbox[3]) / 2
        if rows and abs(cy - rows[-1]["mean_cy"]) <= row_tol:
            rows[-1]["items"].append(e)
            # Running mean
            items = rows[-1]["items"]
            rows[-1]["mean_cy"] = sum(
                (it.bbox[1] + it.bbox[3]) / 2 for it in items
            ) / len(items)
        else:
            rows.append({"items": [e], "mean_cy": cy})

    # Column gap threshold: 6 % of page width
    col_gap = 0.06 * page_width

    # Render rows
    lines: list[str] = []
    for row in rows:
        items = sorted(row["items"], key=lambda e: e.bbox[0])
        parts: list[str] = []
        prev: OcrElement | None = None
        for e in items:
            if prev is not None and (e.bbox[0] - prev.bbox[2]) > col_gap:
                parts.append("|")
            parts.append(e.text)
            prev = e
        lines.append(" ".join(parts))

    return "\n".join(lines)
