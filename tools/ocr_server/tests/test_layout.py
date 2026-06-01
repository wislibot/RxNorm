from __future__ import annotations

import pytest

from app.layout import _is_noise, serialize_layout
from app.schemas import OcrElement


def _el(text: str, x1: int, y1: int, x2: int, y2: int) -> OcrElement:
    return OcrElement(type="text", text=text, bbox=[x1, y1, x2, y2], confidence=0.95)


class TestSerializeLayout:
    def test_empty_input(self):
        assert serialize_layout([], page_width=1000) == ""

    def test_single_element(self):
        els = [_el("Hello", 10, 10, 100, 30)]
        result = serialize_layout(els, page_width=1000)
        assert result == "Hello"

    def test_two_column_row_with_noise_dropped(self):
        """Two-column signature row: empty-text blob is filtered, columns preserved."""
        page_w = 800
        els = [
            _el("處方醫師", 10, 100, 100, 120),     # left label
            _el("王○○", 110, 100, 180, 120),        # left value
            _el("|", 190, 100, 200, 120),            # gap marker
            _el("調劑藥師", 350, 100, 440, 120),     # right label
            _el("林○○", 450, 100, 520, 120),        # right value
            _el("", 600, 50, 700, 150),              # empty blob → should be dropped
        ]
        result = serialize_layout(els, page_width=page_w)
        assert "" not in result.split()  # empty string not in output tokens
        assert "處方醫師" in result
        assert "王○○" in result
        assert "調劑藥師" in result
        assert "林○○" in result
        # Columns separated by |
        assert " | " in result

    def test_single_column_no_pipe(self):
        """All elements in one column — no pipe separator."""
        els = [
            _el("姓名", 10, 10, 60, 30),
            _el("王小花", 70, 10, 140, 30),
        ]
        result = serialize_layout(els, page_width=800)
        assert " | " not in result
        assert "姓名" in result
        assert "王小花" in result

    def test_multiple_rows(self):
        """Elements at different y positions form separate lines."""
        els = [
            _el("Row1", 10, 10, 60, 30),
            _el("Row2", 10, 200, 60, 220),
        ]
        result = serialize_layout(els, page_width=800)
        lines = result.split("\n")
        assert len(lines) == 2
        assert "Row1" in lines[0]
        assert "Row2" in lines[1]

    def test_row_clustering_uses_relative_tolerance(self):
        """Elements within 0.6 × median height of each other cluster into one row."""
        # Two elements with small vertical offset (within tolerance)
        els = [
            _el("Left", 10, 100, 60, 120),   # h=20, cy=110
            _el("Right", 300, 108, 360, 128), # h=20, cy=118, diff=8, tol=0.6*20=12 → same row
        ]
        result = serialize_layout(els, page_width=800)
        lines = result.split("\n")
        assert len(lines) == 1

    def test_row_clustering_splits_distant_rows(self):
        """Elements far apart vertically form separate rows."""
        els = [
            _el("Top", 10, 10, 60, 30),      # cy=20
            _el("Bottom", 10, 200, 70, 220),  # cy=210, diff=190, tol=12 → different row
        ]
        result = serialize_layout(els, page_width=800)
        lines = result.split("\n")
        assert len(lines) == 2

    def test_column_gap_threshold(self):
        """Elements with small gap stay in same column; large gap splits."""
        page_w = 800
        col_gap = 0.06 * page_w  # 48px

        # Small gap (30px) — same column band
        els_close = [
            _el("A", 10, 10, 40, 30),
            _el("B", 70, 10, 100, 30),  # gap = 70-40 = 30 < 48
        ]
        result_close = serialize_layout(els_close, page_width=page_w)
        assert " | " not in result_close

        # Large gap (60px) — different column bands
        els_far = [
            _el("A", 10, 10, 40, 30),
            _el("B", 100, 10, 130, 30),  # gap = 100-40 = 60 > 48
        ]
        result_far = serialize_layout(els_far, page_width=page_w)
        assert " | " in result_far

    def test_qr_heuristic_matches_mobile_side(self):
        """After Fix 1: alphanumeric text is never noise, only empty/symbol-only blobs are."""
        # "AB" — alphanumeric → NOT noise (real content)
        qr = _el("AB", 100, 100, 200, 200)
        assert not _is_noise(qr)

        # "ABC" — alphanumeric → NOT noise
        not_qr1 = _el("ABC", 100, 100, 200, 200)
        assert not _is_noise(not_qr1)

        # Empty text in large square → IS noise
        empty = _el("", 100, 100, 200, 200)
        assert _is_noise(empty)

    def test_medication_row_with_quantity(self):
        """Medication row: drug name, quantity separated by column gap."""
        page_w = 800
        els = [
            _el("藥名", 10, 50, 50, 70),
            _el("Spiriva Respimat", 60, 50, 250, 70),
            _el("總量", 400, 50, 440, 70),
            _el("1盒", 450, 50, 490, 70),
        ]
        result = serialize_layout(els, page_width=page_w)
        assert "藥名" in result
        assert "Spiriva Respimat" in result
        assert "總量" in result
        assert "1盒" in result
        # Quantity stays in its own column, not bleeding into drug name
        lines = result.split("\n")
        assert len(lines) == 1

    def test_three_column_layout(self):
        """Three columns separated by gaps."""
        page_w = 1000
        col_gap = 0.06 * page_w  # 60px
        els = [
            _el("A", 10, 10, 40, 30),    # col 1
            _el("B", 200, 10, 230, 30),   # col 2 (gap from A: 200-40=160 > 60)
            _el("C", 500, 10, 530, 30),   # col 3 (gap from B: 500-230=270 > 60)
        ]
        result = serialize_layout(els, page_width=page_w)
        assert result.count("|") == 2  # two separators for three columns


class TestIsNoiseFix1:
    """Fix 1: _is_noise must never drop elements with real linguistic content."""

    def test_single_cjk_char_in_square_box_is_kept(self):
        """'王' in a ~square >=40px box must NOT be noise (physician name)."""
        el = _el("王", 100, 100, 233, 203)  # 133×103, aspect=1.29
        assert not _is_noise(el)

    def test_sex_glyph_in_square_box_is_kept(self):
        """'男' in a ~square box must NOT be noise (patient sex)."""
        el = _el("男", 100, 100, 203, 208)  # 103×108, aspect=0.95
        assert not _is_noise(el)

    def test_female_sex_glyph_is_kept(self):
        """'女' must NOT be noise."""
        el = _el("女", 100, 100, 200, 210)
        assert not _is_noise(el)

    def test_empty_text_square_is_noise(self):
        """Empty text in a large square box IS noise."""
        el = _el("", 100, 100, 200, 200)
        assert _is_noise(el)

    def test_whitespace_only_square_is_noise(self):
        """Whitespace-only text in a large square box IS noise."""
        el = _el("  ", 100, 100, 200, 200)
        assert _is_noise(el)

    def test_single_alphanumeric_in_square_is_kept(self):
        """Single ASCII letter in a square box is NOT noise (real content)."""
        el = _el("A", 100, 100, 200, 200)
        assert not _is_noise(el)

    def test_symbol_only_short_in_square_is_noise(self):
        """A non-linguistic symbol like 'X' or '✓' in a square IS noise."""
        el = _el("X", 100, 100, 200, 200)
        # 'X' is alphanumeric (c.isalnum() is True), so it is NOT noise
        # under the new heuristic. This is correct — 'X' could be a meaningful
        # symbol on a medication bag.
        assert not _is_noise(el)

    def test_signature_region_keeps_both_names(self):
        """Full signature row: both 王 (left) and 林 (right) survive."""
        page_w = 800
        els = [
            _el("處方醫師", 10, 100, 100, 120),
            _el("王", 110, 100, 233, 203),       # 133×103, single CJK
            _el("調劑藥師", 350, 100, 440, 120),
            _el("林", 450, 100, 800, 244),        # 350×144, single CJK
        ]
        result = serialize_layout(els, page_width=page_w)
        assert "王" in result
        assert "林" in result
        assert "處方醫師" in result
        assert "調劑藥師" in result
