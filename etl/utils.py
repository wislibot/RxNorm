from __future__ import annotations

import csv
import re
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterator
from urllib.parse import parse_qs, unquote, urlparse


_PUNCTUATION_RE = re.compile(r"[^\w\s]+", flags=re.UNICODE)
_WHITESPACE_RE = re.compile(r"\s+")
_PERMIT_TOKEN_RE = re.compile(r"(?:衛|署|部).{0,8}字第[0-9A-Z]+號", flags=re.UNICODE)


def normalize_text(value: str | None) -> str:
    if value is None:
        return ""
    stripped = _PUNCTUATION_RE.sub(" ", value.strip().upper())
    return _WHITESPACE_RE.sub(" ", stripped).strip()


def parse_decimal(value: str | int | float | Decimal | None) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    candidate = str(value).strip().replace(",", "")
    if not candidate or candidate in {"-", "--"}:
        return None
    try:
        return Decimal(candidate)
    except InvalidOperation as exc:
        raise ValueError(f"Invalid decimal value: {value}") from exc


def parse_date(value: str | None) -> date | None:
    if value is None:
        return None
    candidate = value.strip()
    if not candidate:
        return None

    if candidate.isdigit() and len(candidate) in (6, 7):
        year_digits = 3 if len(candidate) == 7 else 2
        roc_year = int(candidate[:year_digits]) + 1911
        month = int(candidate[year_digits : year_digits + 2])
        day = int(candidate[year_digits + 2 : year_digits + 4])
        return date(roc_year, month, day)

    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y%m%d"):
        try:
            return datetime.strptime(candidate, fmt).date()
        except ValueError:
            continue

    raise ValueError(f"Unsupported date format: {value}")


def extract_tfda_permit_no(value: str | None) -> str | None:
    if value is None:
        return None
    candidate = value.strip()
    if not candidate:
        return None

    parsed = urlparse(candidate)
    query = parse_qs(parsed.query)
    for key in ("permitNo", "permitno", "permit_no", "licno", "licenseNo", "licId", "licid"):
        if key in query and query[key]:
            return unquote(query[key][0]).strip()

    path_match = _PERMIT_TOKEN_RE.search(unquote(parsed.path))
    if path_match:
        return path_match.group(0).strip()

    last_segment = unquote(parsed.path.rsplit("/", maxsplit=1)[-1]).strip()
    return last_segment or None


def split_tfda_ingredients(value: str | None) -> list[str]:
    if value is None:
        return []
    return [segment.strip() for segment in value.split(";;") if segment.strip()]


def _open_text_file(path: Path, encoding: str | None = None):
    encodings = [encoding] if encoding else []
    encodings.extend(["utf-8-sig", "utf-8", "cp950"])

    tried: list[str] = []
    for candidate in encodings:
        if candidate in tried or candidate is None:
            continue
        tried.append(candidate)
        try:
            return path.open("r", encoding=candidate, newline="")
        except UnicodeDecodeError:
            continue

    return path.open("r", encoding="utf-8", errors="replace", newline="")


def open_delimited_rows(
    path: Path | str,
    delimiter: str | None = None,
    encoding: str | None = None,
) -> Iterator[dict[str, str]]:
    file_path = Path(path)
    actual_delimiter = delimiter or ("," if file_path.suffix.lower() == ".csv" else "|")
    with _open_text_file(file_path, encoding=encoding) as handle:
        reader = csv.DictReader(handle, delimiter=actual_delimiter)
        for row in reader:
            yield {str(key): (value or "") for key, value in row.items() if key is not None}


def build_import_batch_payload(
    source_name: str,
    row_count: int,
    source_version: str | None = None,
    notes: str | None = None,
    imported_at: datetime | None = None,
) -> dict[str, str | int | None]:
    timestamp = imported_at or datetime.now(timezone.utc)
    return {
        "import_batch_id": str(uuid.uuid4()),
        "source_name": source_name,
        "source_version": source_version,
        "imported_at": timestamp.isoformat(),
        "row_count": row_count,
        "notes": notes,
    }
