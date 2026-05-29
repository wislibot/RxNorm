import os

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader

API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)

_API_KEY = os.environ.get("OCR_API_KEY", "")


async def require_api_key(api_key: str = Security(API_KEY_HEADER)) -> None:
    if not _API_KEY:
        return
    if not api_key:
        raise HTTPException(status_code=401, detail="Missing X-API-Key header")
    if api_key != _API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
