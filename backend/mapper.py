from __future__ import annotations

import re
from typing import Dict, List, Sequence, Tuple, Optional

from .models import ExtractedField, FieldRect


def map_fields_to_rects(structured: Dict, raw_text: str, layout: Dict) -> Dict:
    fields = structured.get("fields", []) or []
    pages = layout.get("pages", [])
    page_sizes = {
        index: (
            float(page.get("width", 1.0)),
            float(page.get("height", 1.0)),
        )
        for index, page in enumerate(pages)
    }
    flat_chars = _flatten_chars(pages)
    mapped_fields: List[Dict] = []

    for field in fields:
        label = field.get("label") or field.get("name") or "Unknown"
        value = str(field.get("value", "")).strip()
        snippet = str(field.get("snippet", "")).strip() or value

        # Try multiple matching strategies for better accuracy
        offsets = _find_best_match(raw_text, snippet, value)
        
        rects: List[FieldRect] = []
        if offsets:
            start, end = offsets
            rects = _offset_to_rects(start, end, flat_chars, page_sizes)

        mapped_fields.append(
            ExtractedField(
                label=label,
                value=value,
                snippet=snippet,
                rects=rects,
            ).model_dump()
        )

    return {"fields": mapped_fields}


def _find_best_match(raw_text: str, snippet: str, value: str) -> Optional[Tuple[int, int]]:
    """Try multiple matching strategies to find the best match."""
    
    # Strategy 1: Exact match on snippet
    offsets = _find_exact_offsets(raw_text, snippet)
    if offsets:
        return offsets[0]
    
    # Strategy 2: Exact match on value
    if value and value != snippet:
        offsets = _find_exact_offsets(raw_text, value)
        if offsets:
            return offsets[0]
    
    # Strategy 3: Case-insensitive match on snippet
    offsets = _find_case_insensitive_offsets(raw_text, snippet)
    if offsets:
        return offsets[0]
    
    # Strategy 4: Case-insensitive match on value
    if value and value != snippet:
        offsets = _find_case_insensitive_offsets(raw_text, value)
        if offsets:
            return offsets[0]
    
    # Strategy 5: Normalized whitespace match
    offsets = _find_normalized_offsets(raw_text, snippet)
    if offsets:
        return offsets[0]
    
    # Strategy 6: Try with value normalized
    if value and value != snippet:
        offsets = _find_normalized_offsets(raw_text, value)
        if offsets:
            return offsets[0]
    
    # Strategy 7: Fuzzy match - find longest matching substring
    result = _find_fuzzy_match(raw_text, snippet if snippet else value)
    if result:
        return result
    
    return None


def _flatten_chars(pages: Sequence[Dict]) -> List[Dict]:
    flat: List[Dict] = []
    for page in pages:
        for ch in page.get("chars", []):
            flat.append(ch)
    flat.sort(key=lambda item: item.get("global_offset", 0))
    return flat


def _find_exact_offsets(raw_text: str, snippet: str) -> List[Tuple[int, int]]:
    """Find exact match (case-sensitive) for the snippet."""
    snippet_clean = (snippet or "").strip()
    if not snippet_clean or len(snippet_clean) < 2:
        return []
    offsets: List[Tuple[int, int]] = []
    start = raw_text.find(snippet_clean)
    while start != -1:
        offsets.append((start, start + len(snippet_clean)))
        start = raw_text.find(snippet_clean, start + 1)
    return offsets


def _find_case_insensitive_offsets(raw_text: str, snippet: str) -> List[Tuple[int, int]]:
    """Find case-insensitive match for the snippet."""
    snippet_clean = (snippet or "").strip()
    if not snippet_clean or len(snippet_clean) < 2:
        return []
    haystack = raw_text.lower()
    needle = snippet_clean.lower()
    offsets: List[Tuple[int, int]] = []
    start = haystack.find(needle)
    while start != -1:
        offsets.append((start, start + len(snippet_clean)))
        start = haystack.find(needle, start + 1)
    return offsets


def _find_normalized_offsets(raw_text: str, snippet: str) -> List[Tuple[int, int]]:
    """Find match with normalized whitespace."""
    snippet_clean = (snippet or "").strip()
    if not snippet_clean or len(snippet_clean) < 2:
        return []
    
    # Normalize whitespace in both texts
    normalized_snippet = re.sub(r'\s+', ' ', snippet_clean.lower())
    normalized_text = re.sub(r'\s+', ' ', raw_text.lower())
    
    start = normalized_text.find(normalized_snippet)
    if start == -1:
        return []
    
    # Map back to original text position (approximate)
    # Count spaces before this position in normalized text
    original_pos = 0
    normalized_pos = 0
    while normalized_pos < start and original_pos < len(raw_text):
        if raw_text[original_pos].isspace():
            if normalized_pos == 0 or normalized_text[normalized_pos - 1] != ' ':
                normalized_pos += 1
        else:
            normalized_pos += 1
        original_pos += 1
    
    return [(original_pos, original_pos + len(snippet_clean))]


def _find_fuzzy_match(raw_text: str, snippet: str) -> Optional[Tuple[int, int]]:
    """Find the longest matching substring using sliding window."""
    snippet_clean = (snippet or "").strip()
    if not snippet_clean or len(snippet_clean) < 3:
        return None
    
    raw_lower = raw_text.lower()
    snippet_lower = snippet_clean.lower()
    
    # Try to find progressively shorter substrings
    min_match_len = max(3, len(snippet_clean) // 2)
    
    for length in range(len(snippet_clean), min_match_len - 1, -1):
        for start_pos in range(len(snippet_clean) - length + 1):
            substring = snippet_lower[start_pos:start_pos + length]
            idx = raw_lower.find(substring)
            if idx != -1:
                return (idx, idx + length)
    
    return None


def _offset_to_rects(
    start: int,
    end: int,
    chars: Sequence[Dict],
    page_sizes: Dict[int, Tuple[float, float]],
) -> List[FieldRect]:
    """Convert text offsets to precise bounding rectangles."""
    relevant = [ch for ch in chars if start <= ch.get("global_offset", -1) < end]
    if not relevant:
        return []

    rects: List[FieldRect] = []
    current = None
    previous_offset = None
    previous_y = None

    for ch in relevant:
        offset = ch.get("global_offset", 0)
        page = int(ch.get("page", 0))
        x0 = float(ch.get("x0", 0.0))
        y0 = float(ch.get("y0", 0.0))
        x1 = float(ch.get("x1", 0.0))
        y1 = float(ch.get("y1", 0.0))

        # Only merge if same page, consecutive, and same line (similar y position)
        same_line = previous_y is not None and abs(y0 - previous_y) < 5
        should_merge = (
            current is not None
            and current["page"] == page
            and previous_offset is not None
            and offset - previous_offset <= 1
            and same_line
        )

        if should_merge:
            current["x0"] = min(current["x0"], x0)
            current["y0"] = min(current["y0"], y0)
            current["x1"] = max(current["x1"], x1)
            current["y1"] = max(current["y1"], y1)
        else:
            if current:
                rects.append(FieldRect(**current))
            width, height = page_sizes.get(page, (1.0, 1.0))
            current = {
                "page": page,
                "x0": x0,
                "y0": y0,
                "x1": x1,
                "y1": y1,
                "page_width": width,
                "page_height": height,
            }

        previous_offset = offset
        previous_y = y0

    if current:
        rects.append(FieldRect(**current))
    return rects
