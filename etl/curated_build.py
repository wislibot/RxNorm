from __future__ import annotations

import json
import re
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Any

from .utils import extract_tfda_permit_no, normalize_text, split_tfda_ingredients

_STRENGTH_UNITS = ("MMOL", "MEQ", "MCG", "MOL", "MG", "ML", "IU", "UG", "GM", "G", "U", "L", "%")
_STRENGTH_UNIT_PATTERN = "(?:" + "|".join(_STRENGTH_UNITS) + ")"
_CONCENTRATION_RE = re.compile(
    rf"\b\d+(?:\.\d+)?\s*(?:{_STRENGTH_UNIT_PATTERN})(?:\s*/\s*(?:{_STRENGTH_UNIT_PATTERN}))+",
    flags=re.IGNORECASE,
)
_DOSE_RE = re.compile(
    rf"\b\d+(?:\.\d+)?\s*(?:{_STRENGTH_UNIT_PATTERN})\b",
    flags=re.IGNORECASE,
)
_STANDALONE_NUMBER_RE = re.compile(r"(?<![A-Z])\b\d+(?:\.\d+)?\b(?![A-Z])", flags=re.IGNORECASE)
_STANDALONE_UNIT_RE = re.compile(rf"\b(?:{_STRENGTH_UNIT_PATTERN})\b", flags=re.IGNORECASE)
_PAREN_EQ_RE = re.compile(r"\(\s*=\s*", flags=re.IGNORECASE)
_PAREN_EQ_TO_RE = re.compile(r"\(\s*EQ\s+TO\s+", flags=re.IGNORECASE)
_PAREN_CONTENT_RE = re.compile(r"\(([^()]*)\)")
_DL_PREFIX_RE = re.compile(r"(?<![A-Z0-9])DL\s*-\s*", flags=re.IGNORECASE)
_DL_STANDALONE_RE = re.compile(r"(?<![A-Z0-9])DL(?![A-Z0-9])", flags=re.IGNORECASE)
_SALT_TOKEN_RE = re.compile(r"^(?P<root>[^()]+?)\s*\((?P<content>[^()]+)\)\s*$")
_SALT_CONTENT_ALLOWED_RE = re.compile(r"^[A-Z0-9 -]+$")
_SALT_KEYWORDS = (
    "HCL",
    "HBR",
    "SODIUM",
    "POTASSIUM",
    "CALCIUM",
    "MAGNESIUM",
    "PHOSPHATE",
    "SULFATE",
    "NITRATE",
    "ACETATE",
    "CITRATE",
    "TARTRATE",
    "MONOHYDRATE",
    "DIHYDRATE",
    "HYDRATE",
    "ESTOLATE",
    "SUCCINATE",
    "MALEATE",
    "FUMARATE",
    "BESYLATE",
    "MESYLATE",
    "TOSYLATE",
    "GLUCONATE",
    "CHLORIDE",
)
_SALT_KEYWORD_RE = re.compile(r"\b(?:" + "|".join(_SALT_KEYWORDS) + r")\b", flags=re.IGNORECASE)
_DIHCL_RE = re.compile(r"\bDI\s*-?\s*HCL\b", flags=re.IGNORECASE)
_TWO_HCL_RE = re.compile(r"\b2\s*HCL\b", flags=re.IGNORECASE)
_TWO_HCL_HYDRATE_RE = re.compile(r"\b2HCL(?:\s+(?:MONOHYDRATE|DIHYDRATE|HYDRATE))\b", flags=re.IGNORECASE)
_ALIAS_DATA_PATH = Path(__file__).with_name("data") / "ingredient_aliases.json"


def build_curated_payload(
    raw_data: dict[str, list[dict[str, Any]]],
    *,
    review_threshold: float = 0.6,
    built_at: datetime | None = None,
) -> dict[str, list[dict[str, Any]]]:
    built_timestamp = built_at or datetime.now(timezone.utc)
    alias_usage_counts: dict[str, int] = {}
    latest_nhi_rows = _select_latest_nhi_rows(raw_data.get("raw_nhi_items", []))
    tfda_lookup = _build_tfda_lookup(
        raw_data.get("raw_tfda_permits_active", []),
        raw_data.get("raw_tfda_permits_all", []),
    )
    tfda_suffix_index = _build_tfda_suffix_index(tfda_lookup)
    atc_latest = _build_latest_atc(raw_data.get("raw_atc_ddd", []))

    drug_products = [
        {
            "nhi_code": row["nhi_code"],
            "name_zh": row.get("name_zh"),
            "name_en": row.get("name_en"),
            "ingredient_text_nhi": row.get("ingredient_text"),
            "dose_form": row.get("dose_form"),
            "strength_value": row.get("strength_value"),
            "strength_unit": row.get("strength_unit"),
            "is_combo": _is_combo(row.get("combo_flag")),
            "atc_code": row.get("atc_code"),
            "tfda_link": row.get("tfda_link"),
            "price_nhi": row.get("price_nhi"),
            "effective_start": row.get("effective_start"),
            "effective_end": row.get("effective_end"),
            "updated_at": built_timestamp,
        }
        for row in latest_nhi_rows.values()
    ]
    drug_products.sort(key=lambda row: row["nhi_code"])

    tfda_permits = [
        _map_curated_tfda_permit(row, built_timestamp)
        for row in tfda_lookup.values()
    ]
    tfda_permits.sort(key=lambda row: row["tfda_permit_no"])

    nhi_tfda_map = []
    review_queue = []
    ingredient_concepts_map: dict[str, dict[str, Any]] = {}
    product_ingredients: list[dict[str, Any]] = []
    name_variants: list[dict[str, Any]] = []

    for product in drug_products:
        nhi_row = latest_nhi_rows[product["nhi_code"]]
        permit_no, tfda_row = _resolve_tfda_link(product, tfda_lookup, tfda_suffix_index)
        if permit_no and tfda_row:
            nhi_tfda_map.append(
                {
                    "nhi_code": product["nhi_code"],
                    "tfda_permit_no": permit_no,
                    "link_source": "nhi_tfda_link",
                    "created_at": built_timestamp,
                }
            )

        nhi_ingredients = _split_ingredient_text(nhi_row.get("ingredient_text"))
        tfda_ingredients = _split_tfda_ingredient_text(tfda_row.get("ingredient_text_tfda") if tfda_row else None)

        product_ingredients.extend(
            _build_product_ingredient_rows(
                ingredient_concepts_map,
                product["nhi_code"],
                nhi_ingredients,
                source="nhi",
            )
        )
        product_ingredients.extend(
            _build_product_ingredient_rows(
                ingredient_concepts_map,
                product["nhi_code"],
                tfda_ingredients,
                source="tfda",
            )
        )

        name_variants.extend(_build_product_name_variants(product, built_timestamp))
        name_variants.extend(
            _build_ingredient_name_variants(ingredient_concepts_map, nhi_ingredients, source="nhi", built_at=built_timestamp)
        )
        name_variants.extend(
            _build_ingredient_name_variants(ingredient_concepts_map, tfda_ingredients, source="tfda", built_at=built_timestamp)
        )

        if permit_no and tfda_row:
            review_item = _build_mismatch_review_item(
                product=product,
                tfda_permit_no=permit_no,
                tfda_ingredients=tfda_ingredients,
                ingredient_concepts_map=ingredient_concepts_map,
                alias_usage_counts=alias_usage_counts,
                review_threshold=Decimal(str(review_threshold)),
                built_at=built_timestamp,
            )
            if review_item is not None:
                review_queue.append(review_item)

    ingredient_concepts = sorted(ingredient_concepts_map.values(), key=lambda row: row["canonical_name_normalized"])
    ingredient_tokens = _build_ingredient_tokens(ingredient_concepts)
    product_ingredients = _dedupe_product_ingredients(product_ingredients)
    name_variants = _dedupe_variants(name_variants)
    nhi_tfda_map.sort(key=lambda row: (row["nhi_code"], row["tfda_permit_no"]))
    review_queue.sort(key=lambda row: (row["nhi_code"] or "", row["tfda_permit_no"] or ""))

    return {
        "rx_drug_products": drug_products,
        "rx_ingredient_concepts": ingredient_concepts,
        "rx_ingredient_tokens": ingredient_tokens,
        "rx_product_ingredients": product_ingredients,
        "rx_name_variants": name_variants,
        "rx_tfda_permits": tfda_permits,
        "rx_nhi_tfda_map": nhi_tfda_map,
        "rx_atc_reference_latest": atc_latest,
        "rx_review_queue": review_queue,
        "alias_usage_counts": dict(sorted(alias_usage_counts.items())),
    }


def review_signature(review_item: dict[str, Any]) -> tuple[str | None, ...]:
    return (
        review_item.get("source"),
        review_item.get("nhi_code"),
        review_item.get("tfda_permit_no"),
        review_item.get("input_text"),
        review_item.get("ocr_text"),
    )


def merge_review_queue_items(
    existing_items: list[dict[str, Any]],
    new_items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged = list(existing_items)
    seen = {review_signature(item) for item in existing_items}
    for item in new_items:
        signature = review_signature(item)
        if signature not in seen:
            merged.append(item)
            seen.add(signature)
    return merged


def _select_latest_nhi_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for row in rows:
        nhi_code = row.get("nhi_code")
        if not nhi_code:
            continue
        current = latest.get(nhi_code)
        if current is None or _nhi_sort_key(row) > _nhi_sort_key(current):
            latest[nhi_code] = row
    return latest


def _nhi_sort_key(row: dict[str, Any]) -> tuple[date, date]:
    return (
        row.get("effective_start") or date.min,
        row.get("effective_end") or date.max,
    )


def _build_tfda_lookup(active_rows: list[dict[str, Any]], all_rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for row in all_rows:
        permit_no = row.get("tfda_permit_no")
        if permit_no:
            lookup[permit_no] = row
    for row in active_rows:
        permit_no = row.get("tfda_permit_no")
        if permit_no:
            lookup[permit_no] = row
    return lookup


def _build_tfda_suffix_index(
    tfda_lookup: dict[str, dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    index: dict[str, list[dict[str, Any]]] = {}
    for permit_no, row in tfda_lookup.items():
        digits = "".join(char for char in str(permit_no) if char.isdigit())
        if len(digits) >= 6:
            index.setdefault(digits[-6:], []).append(row)
    return index


def _resolve_tfda_link(
    product: dict[str, Any],
    tfda_lookup: dict[str, dict[str, Any]],
    tfda_suffix_index: dict[str, list[dict[str, Any]]],
) -> tuple[str | None, dict[str, Any] | None]:
    token = extract_tfda_permit_no(product.get("tfda_link"))
    if not token:
        return None, None

    direct_row = tfda_lookup.get(token)
    if direct_row is not None:
        return token, direct_row

    token_digits = "".join(char for char in token if char.isdigit())
    if len(token_digits) < 6:
        return None, None

    suffix = token_digits[-6:]
    candidates = tfda_suffix_index.get(suffix, [])
    if not candidates:
        return None, None

    if len(candidates) == 1:
        row = candidates[0]
        return row.get("tfda_permit_no"), row

    target_names = {
        normalize_text(product.get("name_zh")),
        normalize_text(product.get("name_en")),
    }
    target_names.discard("")
    named_candidates = [
        row
        for row in candidates
        if normalize_text(row.get("product_name_zh")) in target_names
        or normalize_text(row.get("product_name_en")) in target_names
    ]
    if len(named_candidates) == 1:
        row = named_candidates[0]
        return row.get("tfda_permit_no"), row

    for row in candidates:
        if normalize_text(row.get("dosage_form")) == normalize_text(product.get("dose_form")):
            return row.get("tfda_permit_no"), row

    row = candidates[0]
    return row.get("tfda_permit_no"), row


def _build_latest_atc(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for row in rows:
        atc_code = row.get("atc_code")
        if not atc_code:
            continue
        current = latest.get(atc_code)
        if current is None or (row.get("snapshot_date") or date.min) > (current.get("snapshot_date") or date.min):
            latest[atc_code] = {
                "atc_code": atc_code,
                "atc_name": row.get("atc_name"),
                "ddd": row.get("ddd"),
                "uom": row.get("uom"),
                "adm_r": row.get("adm_r"),
                "note": row.get("note"),
                "snapshot_date": row.get("snapshot_date"),
            }
    return sorted(latest.values(), key=lambda row: row["atc_code"])


def _is_combo(combo_flag: Any) -> bool:
    value = str(combo_flag or "").strip()
    return bool(value) and ("複" in value or value.upper() in {"Y", "YES", "TRUE", "COMBO"})


def _split_ingredient_text(value: Any) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    parts = re.split(r"\s*(?:;;|,|\+|/| AND )\s*", text, flags=re.IGNORECASE)
    return [part.strip() for part in parts if part.strip()]


def _split_tfda_ingredient_text(value: Any) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    return split_tfda_ingredients(text)


def _normalize_synonym_markers(text: str) -> str:
    normalized = _PAREN_EQ_RE.sub("(", text)
    normalized = _PAREN_EQ_TO_RE.sub("(", normalized)
    normalized = _PAREN_CONTENT_RE.sub(_normalize_parenthetical_content, normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def strip_strength_and_formulation_tokens(text: str) -> str:
    cleaned = _normalize_synonym_markers(text)
    cleaned = _CONCENTRATION_RE.sub(" ", cleaned)
    cleaned = _DOSE_RE.sub(" ", cleaned)
    cleaned = _STANDALONE_NUMBER_RE.sub(" ", cleaned)
    cleaned = _STANDALONE_UNIT_RE.sub(" ", cleaned)
    cleaned = re.sub(r"\(\s*\)", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned.strip("+,/; ")


def _normalize_compare_token(text: str) -> str:
    candidate = _normalize_stereochemistry_markers(text)
    candidate = _canonicalize_salt_expression(candidate)
    return normalize_text(candidate)


def _compare_tokens_for_ingredient(
    text: str,
    *,
    alias_usage_counts: dict[str, int] | None = None,
) -> set[str]:
    cleaned = strip_strength_and_formulation_tokens(text)
    root = cleaned.split("(", maxsplit=1)[0].strip()
    base_candidate = root or cleaned.strip()
    compare_tokens = {
        _apply_alias_mapping(_normalize_compare_token(base_candidate), alias_usage_counts=alias_usage_counts)
    }

    flattened = _flatten_salt_parentheses(cleaned)
    if flattened != cleaned:
        compare_tokens.add(
            _apply_alias_mapping(_normalize_compare_token(flattened), alias_usage_counts=alias_usage_counts)
        )

    compare_tokens.discard("")
    return compare_tokens


def _normalize_parenthetical_content(match: re.Match[str]) -> str:
    content = match.group(1)
    normalized = re.sub(r"^\s*=\s*", "", content, flags=re.IGNORECASE)
    normalized = re.sub(r"^\s*EQ\s+TO\s+", "", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\s*=\s*", " ; ", normalized)
    normalized = re.sub(r"\s+OR\s+", " ; ", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\s+", " ", normalized).strip(" ;")
    if not normalized:
        return ""
    return f"({normalized})"


def _normalize_stereochemistry_markers(text: str) -> str:
    normalized = _DL_PREFIX_RE.sub("", text)
    normalized = _DL_STANDALONE_RE.sub(" ", normalized)
    return re.sub(r"\s+", " ", normalized).strip(" -")


def _flatten_salt_parentheses(token: str) -> str:
    cleaned = re.sub(r"\s+", " ", token).strip()
    match = _SALT_TOKEN_RE.fullmatch(cleaned)
    if match is None:
        return cleaned

    root = match.group("root").strip()
    content = match.group("content").strip()
    normalized_content = normalize_text(content)
    if not root or not normalized_content:
        return cleaned
    if len(normalized_content) > 30:
        return cleaned
    if not _SALT_CONTENT_ALLOWED_RE.fullmatch(content.upper()):
        return cleaned
    if not _SALT_KEYWORD_RE.search(normalized_content):
        return cleaned

    return f"{root} {normalized_content}".strip()


def _canonicalize_salt_expression(text: str) -> str:
    normalized = _DIHCL_RE.sub("2HCL", text)
    normalized = _TWO_HCL_RE.sub("2HCL", normalized)
    normalized = _TWO_HCL_HYDRATE_RE.sub("2HCL", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


@lru_cache(maxsize=1)
def _load_ingredient_alias_map() -> tuple[dict[str, str], tuple[str, ...]]:
    raw_mapping = json.loads(_ALIAS_DATA_PATH.read_text(encoding="utf-8"))
    alias_to_canonical: dict[str, str] = {}
    canonicals: set[str] = set()

    for canonical, aliases in raw_mapping.items():
        normalized_canonical = _normalize_compare_token(canonical)
        canonicals.add(normalized_canonical)
        claimed_names = [canonical, *aliases]
        for name in claimed_names:
            normalized_name = _normalize_compare_token(name)
            existing = alias_to_canonical.get(normalized_name)
            if existing is not None and existing != normalized_canonical:
                raise ValueError(
                    f"Ingredient alias collision for '{normalized_name}': '{existing}' vs '{normalized_canonical}'"
                )
            alias_to_canonical[normalized_name] = normalized_canonical

    return alias_to_canonical, tuple(sorted(alias_to_canonical, key=len, reverse=True))


def _apply_alias_mapping(
    token: str,
    alias_usage_counts: dict[str, int] | None = None,
) -> str:
    normalized_token = _normalize_compare_token(token)
    alias_to_canonical, lookup_order = _load_ingredient_alias_map()

    exact_match = alias_to_canonical.get(normalized_token)
    if exact_match is not None:
        if exact_match != normalized_token and alias_usage_counts is not None:
            alias_usage_counts[exact_match] = alias_usage_counts.get(exact_match, 0) + 1
        return exact_match

    for alias_key in lookup_order:
        canonical = alias_to_canonical[alias_key]
        if normalized_token.startswith(alias_key + " "):
            remapped = canonical + normalized_token[len(alias_key) :]
            if remapped != normalized_token and alias_usage_counts is not None:
                alias_usage_counts[canonical] = alias_usage_counts.get(canonical, 0) + 1
            return remapped

    return normalized_token


def _canonical_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def _stem_word(word: str) -> str:
    """Simple English plural stemmer for ingredient token matching.

    Handles: -IES→-Y, -SES/-XES/-ZES→strip 2, -[non-S]S→strip 1.
    Not a general-purpose stemmer — tuned for drug ingredient names.
    """
    if len(word) <= 3:
        return word
    if word.endswith("IES"):
        return word[:-3] + "Y"
    if word.endswith(("SES", "XES", "ZES")):
        return word[:-2]
    if word.endswith("S") and len(word) > 2 and word[-2] != "S":
        return word[:-1]
    return word


def _ensure_ingredient_concept(ingredient_concepts_map: dict[str, dict[str, Any]], ingredient_text: str) -> dict[str, Any]:
    canonical = _canonical_name(ingredient_text)
    normalized = normalize_text(canonical)
    concept = ingredient_concepts_map.get(normalized)
    if concept is None:
        concept = {
            "ingredient_id": str(uuid.uuid5(uuid.NAMESPACE_URL, normalized)),
            "canonical_name": canonical,
            "canonical_name_normalized": normalized,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }
        ingredient_concepts_map[normalized] = concept
    return concept


def _build_ingredient_tokens(
    ingredient_concepts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Generate token rows for indexed ingredient matching."""
    tokens: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for concept in ingredient_concepts:
        ingredient_id = concept["ingredient_id"]
        normalized = concept.get("canonical_name_normalized") or normalize_text(concept["canonical_name"])
        for word in normalized.split():
            if len(word) < 2:
                continue
            key = (ingredient_id, word)
            if key in seen:
                continue
            seen.add(key)
            tokens.append({
                "ingredient_id": ingredient_id,
                "token": word,
                "token_stem": _stem_word(word),
            })
    return tokens


def _build_product_ingredient_rows(
    ingredient_concepts_map: dict[str, dict[str, Any]],
    nhi_code: str,
    ingredient_texts: list[str],
    *,
    source: str,
) -> list[dict[str, Any]]:
    rows = []
    for ingredient_text in ingredient_texts:
        concept = _ensure_ingredient_concept(ingredient_concepts_map, ingredient_text)
        rows.append(
            {
                "nhi_code": nhi_code,
                "ingredient_id": concept["ingredient_id"],
                "role": "active",
                "strength_value": None,
                "strength_unit": None,
                "source": source,
            }
        )
    return rows


def _dedupe_product_ingredients(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in rows:
        key = (row["nhi_code"], row["ingredient_id"], row["source"])
        deduped.setdefault(key, row)
    return sorted(deduped.values(), key=lambda row: (row["nhi_code"], row["ingredient_id"], row["source"]))


def _build_product_name_variants(product: dict[str, Any], built_at: datetime) -> list[dict[str, Any]]:
    variants = []
    for field_name, language, variant_type in (
        ("name_zh", "zh", "product_name_zh"),
        ("name_en", "en", "product_name_en"),
    ):
        value = product.get(field_name)
        if value:
            variants.append(
                {
                    "variant_id": str(uuid.uuid4()),
                    "target_type": "product",
                    "target_id": product["nhi_code"],
                    "variant_text": value,
                    "normalized_text": normalize_text(value),
                    "language": language,
                    "variant_type": variant_type,
                    "source": "nhi",
                    "created_at": built_at,
                }
            )
    return variants


def _build_ingredient_name_variants(
    ingredient_concepts_map: dict[str, dict[str, Any]],
    ingredient_texts: list[str],
    *,
    source: str,
    built_at: datetime,
) -> list[dict[str, Any]]:
    variants = []
    for ingredient_text in ingredient_texts:
        concept = _ensure_ingredient_concept(ingredient_concepts_map, ingredient_text)
        variants.append(
            {
                "variant_id": str(uuid.uuid4()),
                "target_type": "ingredient",
                "target_id": concept["ingredient_id"],
                "variant_text": ingredient_text,
                "normalized_text": normalize_text(ingredient_text),
                "language": _detect_language(ingredient_text),
                "variant_type": "ingredient_alias",
                "source": source,
                "created_at": built_at,
            }
        )
    return variants


def _detect_language(value: str) -> str:
    has_cjk = any("\u4e00" <= char <= "\u9fff" for char in value)
    has_ascii = any(char.isascii() and char.isalpha() for char in value)
    if has_cjk and has_ascii:
        return "mixed"
    if has_cjk:
        return "zh"
    return "en"


def _map_curated_tfda_permit(row: dict[str, Any], built_at: datetime) -> dict[str, Any]:
    cancel_status = str(row.get("cancel_status") or "").strip()
    is_cancelled = bool(cancel_status) and cancel_status not in {"未註銷", "N", "0"}
    return {
        "tfda_permit_no": row.get("tfda_permit_no"),
        "is_cancelled": is_cancelled,
        "cancel_date": row.get("cancel_date"),
        "expiry_date": row.get("expiry_date"),
        "issue_date": row.get("issue_date"),
        "controlled_substance_level": row.get("controlled_substance_level"),
        "product_name": row.get("product_name_zh") or row.get("product_name_en"),
        "dosage_form": row.get("dosage_form"),
        "packaging": row.get("packaging"),
        "ingredient_text_tfda": row.get("ingredient_text_tfda"),
        "applicant_name": row.get("applicant_name"),
        "applicant_address": row.get("applicant_address"),
        "applicant_tax_id": row.get("applicant_tax_id"),
        "manufacturer_name": row.get("manufacturer_name"),
        "manufacturer_address": row.get("manufacturer_company_address") or row.get("manufacturer_site_address"),
        "manufacturer_country": row.get("manufacturer_country"),
        "updated_at": built_at,
    }


def _build_mismatch_review_item(
    *,
    product: dict[str, Any],
    tfda_permit_no: str,
    tfda_ingredients: list[str],
    ingredient_concepts_map: dict[str, dict[str, Any]],
    alias_usage_counts: dict[str, int],
    review_threshold: Decimal,
    built_at: datetime,
) -> dict[str, Any] | None:
    clean_nhi_text = strip_strength_and_formulation_tokens(product.get("ingredient_text_nhi") or "")
    nhi_ingredients = _split_ingredient_text(clean_nhi_text)
    if not nhi_ingredients or not tfda_ingredients:
        return None

    nhi_normalized = {
        token
        for item in nhi_ingredients
        for token in _compare_tokens_for_ingredient(item, alias_usage_counts=alias_usage_counts)
    }
    tfda_normalized = {
        token
        for item in tfda_ingredients
        for token in _compare_tokens_for_ingredient(item, alias_usage_counts=alias_usage_counts)
    }
    if not nhi_normalized or not tfda_normalized:
        return None
    if nhi_normalized == tfda_normalized:
        return None
    if tfda_normalized.issubset(nhi_normalized):
        return None

    union = nhi_normalized | tfda_normalized
    confidence = Decimal(len(nhi_normalized & tfda_normalized)) / Decimal(len(union))
    if confidence >= review_threshold:
        return None

    candidate_ids = sorted(
        {
            _ensure_ingredient_concept(ingredient_concepts_map, ingredient)["ingredient_id"]
            for ingredient in (*nhi_ingredients, *tfda_ingredients)
        }
    )
    # TODO: `ocr_text` stores TFDA comparison text for backward compatibility.
    tfda_review_text = " ;; ".join(tfda_ingredients)
    return {
        "review_id": str(uuid.uuid4()),
        "created_at": built_at,
        "source": "tfda_mismatch",
        "nhi_code": product["nhi_code"],
        "tfda_permit_no": tfda_permit_no,
        "input_text": product.get("ingredient_text_nhi"),
        "ocr_text": tfda_review_text,
        "candidate_ingredient_ids": candidate_ids,
        "confidence": confidence,
        "status": "pending",
        "review_notes": (
            f"NHI ingredients: {product.get('ingredient_text_nhi')}; "
            f"TFDA ingredients: {tfda_review_text}"
        ),
    }


def _dedupe_variants(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for row in rows:
        key = (
            row["target_type"],
            row["target_id"],
            row["normalized_text"],
            row["source"] or "",
        )
        deduped.setdefault(key, row)
    return sorted(deduped.values(), key=lambda row: (row["target_type"], row["target_id"], row["normalized_text"]))
