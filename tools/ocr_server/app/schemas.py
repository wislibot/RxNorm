from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class OcrElement(BaseModel):
    type: str = "text"
    text: str
    bbox: List[float] = Field(description="[x1, y1, x2, y2] in pixel coordinates")
    confidence: float


class ParsedPage(BaseModel):
    width: int
    height: int
    elements: List[OcrElement]


class ParsedResult(BaseModel):
    engine: str = "paddleocr-ppstructurev3"
    version: str = "v1"
    pages: List[ParsedPage]
    case_fields: Optional[Dict[str, Any]] = None
    extraction_engine: str = "none"
    extraction_fallback: bool = False


class HealthResponse(BaseModel):
    status: str = "ok"


class ErrorResponse(BaseModel):
    detail: str
