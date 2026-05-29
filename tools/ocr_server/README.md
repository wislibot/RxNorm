# RxNorm OCR Server

Self-hosted OCR backend using PaddleOCR, served via FastAPI and exposed through Cloudflare Tunnel.

## System Requirements

- Windows 11
- NVIDIA GPU with CUDA support (RTX 3050 Ti or similar)
- Python 3.10 or 3.11 (3.10 recommended for PaddleOCR compatibility)

## Quick Start

### 1. Install Python + CUDA

Ensure Python 3.10 or 3.11 is installed. Verify CUDA:

```powershell
nvidia-smi
```

If CUDA is not available, PaddleOCR will fall back to CPU mode (slower but functional).

### 2. Create Virtual Environment

```powershell
cd e:\TRAE\Projects\RxNorm\tools\ocr_server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 3. Install Dependencies

```powershell
pip install -r requirements.txt
```

**PaddlePaddle GPU note:** The `paddleocr` package auto-installs a compatible `paddlepaddle` wheel. If GPU is not detected, install manually:

```powershell
# For CUDA 11.x
pip install paddlepaddle-gpu==2.6.2 -f https://www.paddlepaddle.org.cn/whl/windows/mkl/avx/stable.html

# For CUDA 12.x
pip install paddlepaddle-gpu==3.0.0 -f https://www.paddlepaddle.org.cn/whl/windows/mkl/avx/stable.html
```

See [PaddlePaddle Windows Installation](https://www.paddlepaddle.org.cn/documentation/docs/en/install/pip/windows-pip_en.html).

### 4. Set API Key

Generate a key:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Set it as environment variable:

```powershell
setx OCR_API_KEY "PASTE_KEY_HERE"
```

> **Windows note:** After `setx`, open a **new terminal** for the variable to take effect. For the current terminal only:

```powershell
$env:OCR_API_KEY = "PASTE_KEY_HERE"
```

Leave `OCR_API_KEY` empty or unset to disable authentication (dev only).

#### Groq LLM Field Extraction (Optional)

The `/parse` endpoint can extract structured case fields from OCR text using Groq's LLM API (Qwen3-32b). This is optional — if not configured, the server returns OCR elements only and the mobile app falls back to regex-based extraction.

Set up via the `.env` file:

1. Copy `.env.example` to `.env`:
   ```powershell
   cp .env.example .env
   ```

2. Edit `.env` and fill in your Groq API key (get one at https://console.groq.com/keys):
   ```
   GROQ_API_KEY=your_actual_key_here
   ```

3. Save the file. No terminal restart needed — `python-dotenv` loads it automatically at startup.

Optionally override the default model in `.env`:
```
GROQ_MODEL=qwen/qwen3-32b
```

Verify the latest available model IDs at https://console.groq.com/docs/models.

Never commit `.env` to git — it's already in `.gitignore`.

### 5. Run Server

```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Server starts at `http://localhost:8000`.

### 6. Test

```powershell
curl http://localhost:8000/health
```

To test OCR parsing:

```powershell
curl -X POST http://localhost:8000/parse \
  -H "X-API-Key: YOUR_KEY" \
  -F "file=@sample.jpg"
```

---

## Cloudflare Tunnel Setup (public HTTPS)

### 1. Install Cloudflared

```powershell
winget install Cloudflare.cloudflared
```

Or download from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

### 2. Login

```powershell
cloudflared tunnel login
```

This opens a browser to authorize with your Cloudflare account.

### 3. Create Tunnel

```powershell
cloudflared tunnel create rxnorm-ocr
```

Note the tunnel ID and credentials file path in the output.

### 4. Point DNS to Tunnel

Replace `ocr.yourdomain.com` with your actual domain managed by Cloudflare:

```powershell
cloudflared tunnel route dns rxnorm-ocr ocr.yourdomain.com
```

### 5. Create Config

Create or edit `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: rxnorm-ocr
credentials-file: C:\Users\YOU\.cloudflared\<tunnel-id>.json
ingress:
  - hostname: ocr.yourdomain.com
    service: http://localhost:8000
  - service: http_status:404
```

Replace `YOU` and `<tunnel-id>` with your actual values.

### 6. Run Tunnel

```powershell
cloudflared tunnel run rxnorm-ocr
```

Your OCR server is now accessible at `https://ocr.yourdomain.com`.

### Security Note

The tunnel URL is public. Always enable API key authentication (`OCR_API_KEY`) in production. Optionally add Cloudflare Access for additional protection.

---

## API Reference

### `GET /health`

No authentication required.

**Response:**
```json
{ "status": "ok" }
```

### `POST /parse`

Requires `X-API-Key` header.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `file` | multipart file | (required) | Image to parse |
| `lang` | query string | `ch` | Language mode (ch/en) |
| `return_images` | query bool | `false` | Not implemented |

**Response:**
```json
{
  "engine": "paddleocr-ppstructurev3",
  "version": "v1",
  "pages": [
    {
      "width": 1024,
      "height": 768,
      "elements": [
        {
          "type": "text",
          "text": "Spiriva Respimat 2.5mcg/puff",
          "bbox": [120, 168, 488, 188],
          "confidence": 0.98
        }
      ]
    }
  ]
}
```

### Error Responses

| Status | Meaning |
|--------|---------|
| 400 | File is not an image |
| 401 | Missing or invalid `X-API-Key` header |
| 413 | Image exceeds 10MB limit |
