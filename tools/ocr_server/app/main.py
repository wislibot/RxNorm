from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .paddle_parser import parse_image_bytes
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

