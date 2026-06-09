from typing import List

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .paddle_parser import parse_image_bytes, parse_multi_image_bytes
from .schemas import ErrorResponse, HealthResponse, ParsedResult
from .security import require_api_key

app = FastAPI(title="RxNorm OCR Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post(
    "/parse",
    response_model=ParsedResult,
    responses={401: {"model": ErrorResponse}, 413: {"model": ErrorResponse}},
    dependencies=[Depends(require_api_key)],
)
async def parse(
    file: UploadFile = File(...),
    lang: str = Query("ch"),
    return_images: bool = Query(False),
) -> ParsedResult:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    contents = await file.read()

    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 10MB)")

    return await parse_image_bytes(contents)


@app.post(
    "/parse-multi",
    response_model=ParsedResult,
    responses={401: {"model": ErrorResponse}, 413: {"model": ErrorResponse}},
    dependencies=[Depends(require_api_key)],
)
async def parse_multi(
    files: List[UploadFile] = File(...),
    lang: str = Query("ch"),
) -> ParsedResult:
    if len(files) < 2:
        raise HTTPException(status_code=400, detail="At least 2 files are required for parse-multi")

    contents_list: list[bytes] = []
    for file in files:
        if not file.content_type or not file.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail=f"File '{file.filename}' must be an image")

        contents = await file.read()

        if len(contents) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail=f"File '{file.filename}' too large (max 10MB)")

        contents_list.append(contents)

    return await parse_multi_image_bytes(contents_list)
