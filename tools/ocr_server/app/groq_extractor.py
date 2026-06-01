from __future__ import annotations

from dotenv import load_dotenv
load_dotenv()

import asyncio
import json
import os
import re
from typing import Optional

from groq import AsyncGroq

GROQ_MODEL = os.environ.get("GROQ_MODEL", "qwen/qwen3-32b")
GROQ_TIMEOUT_S = 15.0

_PROMPT_TEMPLATE = """\
You are a precise medical data extractor for Taiwanese hospital \
medication bags (藥袋). Extract structured fields from OCR text.

The OCR text may contain:
- Traditional Chinese (correct)
- Simplified Chinese (OCR errors, treat same as Traditional)
- English or mixed Chinese/English
- Noise from dosage instruction icons at the bottom of the bag \
(e.g. numbers like "0.5 1 2 3", meal timing words like \
"Morning Afternoon Evening Bedtime Before meal After meal \
With meal", tablet count words like "Half One Two Three", \
icon labels like "For Eye For Ear For Nose")

CRITICAL RULES:
1. Extract ONLY from the labeled fields. Do not invent values.
2. Each field must come from its specific label ONLY — \
do not mix content between fields.
3. IGNORE all dosage icon text at the bottom of the bag. \
Dosage icons contain: numbers (0.5, 1, 2, 3), \
meal timing (早上/Morning, 中午/Afternoon/Noon, \
晚上/Evening, 睡前/Bedtime, 飯前/Before meal, \
飯後/After meal, 飯餐/With meal), tablet counts \
(半錠/Half, 一錠/One, 二錠/Two, 三錠/Three), \
route icons (耳用/For Ear, 眼用/For Eye, 鼻用/For Nose). \
None of these belong in any field.
4. warnings and sideEffects are SEPARATE fields — \
never merge them together.
5. For dispensingDate and useBefore: \
output as YYYY-MM-DD if possible, \
otherwise output the raw date string as-is.
6. For patientSex: output exactly "M" for 男, "F" for 女. \
Do not output the Chinese character.
7. For pharmacistName: extract from 調劑藥師 or Pharmacist \
label ONLY.
8. For physicianName: extract from 處方醫師 or Physician \
label ONLY. Never mix the two.
9. INPUT IS A SPATIAL LAYOUT. Each line is one visual row. \
Within a row, cells are separated by " | " and ordered \
left-to-right. A value is normally the cell to the RIGHT \
of its label, or the cell BELOW it on the next row.
10. A ROW MAY HOLD TWO INDEPENDENT PAIRS. When a row \
contains a left pair and a right pair (separated by " | "), \
pair each label with the value in the SAME COLUMN BAND. \
Never pair a left-column label with a right-column value.
11. PHYSICIAN vs PHARMACIST BY COLUMN. 處方醫師 / Physician \
is the LEFT pair; 調劑藥師 / Pharmacist is the RIGHT pair. \
Assign by column position, ignoring which name was emitted \
first.
12. UNSIGNED SINK. If text cannot be confidently attached to \
a labeled field — e.g. a centered standalone sentence with \
no adjacent label, footer/contact lines — put it in the \
"other" array. Do NOT force it into warnings or sideEffects. \
Leaving a field null is correct and preferred over a wrong \
value.
13. FIELD BOUNDARIES STOP AT THE NEXT LABEL. A field's value \
is only the text in the same row/column as its label, up to \
the next label or the next free-floating row. \
警語與注意事項 captures only its adjacent value, not the \
disclaimer below it.
14. QUANTITY IS A PACK COUNT. quantity is the value of 總量 / \
Quantity and is a DISPENSED PACK COUNT — a small number with \
a pack/dose-form unit such as 盒, 瓶, 罐, 支, 粒, 顆, 包, 條. \
It is NEVER a strength or dosage-form descriptor such as \
"60puff/bot", "mg", "mcg/puff", or "tablet". If a candidate \
quantity value looks like a strength or device descriptor, \
leave quantity null rather than guessing. The pack-count \
token (e.g. 1盒) may appear merged into the medication name \
text; extract it into quantity and do not leave it inside \
medicationName.

Field labels to recognize (standard AND variants):

patientName:
  Standard: 姓名
  Variants: Name, 病患姓名
  -> Extract name only, not the label

patientSex:
  Standard: 性別, 男, 女
  -> "M" for 男/Male, "F" for 女/Female

prescriptionNo:
  Standard: 領藥號
  Variants: Prescription No., Prescripsing No., 處方號

medicationName:
  Standard: 藥名
  Variants: 藥名與含量 (Medication and content), Medication
  -> Include full name with strength and form
  -> Include brand name and generic name if both present

quantity:
  Standard: 總量
  Variants: Quantity, 總量(Quantity), No. of items
  -> Include unit (e.g. 1盒, 28粒, 56粒)

directions:
  Standard: 用法
  Variants: 用法與途經 (Administration), Instruction, \
            用法用量
  -> Full directions text only
  -> Do NOT include dosage icon text

indications:
  Standard: 用途
  Variants: 臨床用途 (Clinical uses), Indications, \
            適應症
  -> Extract text after the label only

warnings:
  Standard: 警語與注意事項
  Variants: 警語, Warnings & Precautions, \
            用藥指示 (Special instructions)
  -> Extract warning text only
  -> STOP before 副作用 or Side effects content

sideEffects:
  Standard: 副作用
  Variants: Side effects, \
            副作用及警語 (side effects and warnings)
  -> Extract side effects text only
  -> Do NOT include dosage icon numbers or meal timing words
  -> STOP before any icon label text

appearance:
  Standard: 外觀
  Variants: 藥品外觀描述 (Appearance), Appearance
  -> Physical description of the pill/medication

pharmacyName:
  -> Hospital or pharmacy name from the document header
  -> Examples: 台南○○醫院, 台北慈濟醫院, \
    台東基督教醫院, 東基醫療財團法人

pharmacyAddress:
  Standard: 地址
  Variants: Address, 地址：
  -> Full address text

pharmacistName:
  Standard: 調劑藥師
  Variants: Pharmacist, 藥師 (when labeled as pharmacist)
  -> Name only, not the label
  -> This is the DISPENSING pharmacist

physicianName:
  Standard: 處方醫師
  Variants: Physician, 醫師 (when labeled as physician), \
            Doctor
  -> Name only, not the label
  -> This is the PRESCRIBING physician
  -> NEVER put pharmacist name here and vice versa

dispensingDate:
  Standard: 調劑日期
  Variants: Dispensing date, Date dispensed, 調制日期
  -> Format as YYYY-MM-DD if possible

useBefore:
  Standard: 處方期限
  Variants: Use Before, Expiry date, 使用期限, \
            使用矽限 (Expiry date)

Return ONLY a valid JSON object with exactly these 17 keys.
All values must be strings or null, except "other" which is a string array.
For multi-line text fields (warnings, sideEffects, directions),
join lines with a space — do NOT use newline characters inside
JSON string values.
No markdown, no code fences, no explanation outside the JSON.

{{
  "patientName": string | null,
  "patientSex": "M" | "F" | null,
  "prescriptionNo": string | null,
  "medicationName": string | null,
  "quantity": string | null,
  "directions": string | null,
  "indications": string | null,
  "warnings": string | null,
  "sideEffects": string | null,
  "appearance": string | null,
  "pharmacyName": string | null,
  "pharmacyAddress": string | null,
  "pharmacistName": string | null,
  "physicianName": string | null,
  "dispensingDate": string | null,
  "useBefore": string | null,
  "other": string[]
}}

Layout Text:
{layout_text}

IMPORTANT: Do NOT use <think> tags or any reasoning.
Respond with ONLY the JSON object starting with curly brace."""

_MARKDOWN_FENCE_RE = re.compile(r"^```(?:json)?\s*\n?(.*?)\n?```$", re.DOTALL)
_THINK_TAG_RE = re.compile(r"<think>.*?</think>", re.DOTALL)
_THINK_PREFIX_RE = re.compile(r"<think>.*?\{", re.DOTALL)


def _strip_markdown_fences(text: str) -> str:
    stripped = _MARKDOWN_FENCE_RE.sub(r"\1", text.strip())
    return stripped.strip()


async def extract_fields_with_groq(layout_text: str) -> Optional[dict]:
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        print("[Groq] GROQ_API_KEY not set, skipping LLM extraction")
        return None

    if not layout_text or not layout_text.strip():
        print("[Groq] Empty layout text, skipping LLM extraction")
        return None

    client = AsyncGroq(api_key=api_key)
    prompt = _PROMPT_TEMPLATE.format(layout_text=layout_text)

    try:
        response = await asyncio.wait_for(
            client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
                max_completion_tokens=2000,
            ),
            timeout=GROQ_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        print("[Groq] LLM extraction timed out after", GROQ_TIMEOUT_S, "seconds")
        return None
    except Exception as exc:
        print("[Groq] LLM API error:", exc)
        return None

    content = response.choices[0].message.content or ""
    content = _strip_markdown_fences(content)
    content = _THINK_TAG_RE.sub("", content)
    content = _THINK_PREFIX_RE.sub("{", content)
    if '<think>' in content:
        bracket_idx = content.find('{')
        if bracket_idx != -1:
            content = content[bracket_idx:]
    content = content.replace('\r\n', ' ').replace('\n', ' ').replace('\r', ' ')

    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        print("[Groq] Failed to parse LLM JSON response:", exc)
        print("[Groq] Raw content:", content[:500])
        return None
