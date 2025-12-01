from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Dict, List, Tuple

import easyocr
import fitz  # PyMuPDF
import numpy as np
import pdfplumber

from .models import ExtractionArtifacts

logger = logging.getLogger(__name__)

_EASY_OCR_READER = None


def _get_easyocr_reader() -> easyocr.Reader:
    global _EASY_OCR_READER
    if _EASY_OCR_READER is None:
        logger.info("Initializing EasyOCR reader (GPU disabled)")
        _EASY_OCR_READER = easyocr.Reader(["en"], gpu=False)
    return _EASY_OCR_READER


def extract_pdf(pdf_path: Path) -> Tuple[str, Dict]:
    """Extract raw text and layout metadata from a PDF file."""
    if not pdf_path.exists():
        raise FileNotFoundError(pdf_path)

    layout = {"pages": []}
    raw_text_parts: List[str] = []
    global_offset = 0

    with pdfplumber.open(str(pdf_path)) as pdf:
        doc = fitz.open(str(pdf_path))
        try:
            for page_index, page in enumerate(pdf.pages):
                page_chars: List[Dict] = []
                page_text_builder: List[str] = []
                chars = page.chars or []

                if chars:
                    for item in chars:
                        char_text = item.get("text", "")
                        if not char_text:
                            continue
                        entry = {
                            "char": char_text,
                            "x0": float(item.get("x0", 0.0)),
                            "y0": float(item.get("top", item.get("y0", 0.0))),
                            "x1": float(item.get("x1", 0.0)),
                            "y1": float(item.get("bottom", item.get("y1", 0.0))),
                            "page": page_index,
                            "global_offset": global_offset,
                        }
                        page_chars.append(entry)
                        page_text_builder.append(char_text)
                        global_offset += len(char_text)
                else:
                    global_ref = [global_offset]
                    _inject_ocr_chars(
                        doc=doc,
                        page_index=page_index,
                        page_chars=page_chars,
                        page_text_builder=page_text_builder,
                        global_offset_ref=global_ref,
                    )
                    global_offset = global_ref[0]

                raw_text_parts.append("".join(page_text_builder))
                raw_text_parts.append("\n")
                global_offset += 1  # track newline separator for upcoming pages

                layout["pages"].append(
                    {
                        "width": float(page.width),
                        "height": float(page.height),
                        "chars": page_chars,
                    }
                )
        finally:
            doc.close()

    raw_text = "".join(raw_text_parts)
    return raw_text, layout


def _inject_ocr_chars(
    *,
    doc: fitz.Document,
    page_index: int,
    page_chars: List[Dict],
    page_text_builder: List[str],
    global_offset_ref: List[int],
) -> None:
    """Populate page_chars/text using EasyOCR for image-only pages."""
    reader = _get_easyocr_reader()
    page = doc.load_page(page_index)
    pix = page.get_pixmap(matrix=fitz.Matrix(1, 1))
    array = np.frombuffer(pix.samples, dtype=np.uint8)
    array = array.reshape(pix.height, pix.width, pix.n)
    if pix.n == 4:
        array = array[:, :, :3]

    ocr_results = reader.readtext(array, detail=1)
    for bbox, text, confidence in ocr_results:
        sanitized = text.strip()
        if not sanitized:
            continue
        x_coords = [point[0] for point in bbox]
        y_coords = [point[1] for point in bbox]
        x0, x1 = float(min(x_coords)), float(max(x_coords))
        y0, y1 = float(min(y_coords)), float(max(y_coords))
        char_width = (x1 - x0) / max(len(sanitized), 1)
        for idx, char in enumerate(sanitized):
            entry = {
                "char": char,
                "x0": x0 + idx * char_width,
                "y0": y0,
                "x1": x0 + (idx + 1) * char_width,
                "y1": y1,
                "page": page_index,
                "global_offset": global_offset_ref[0],
            }
            page_chars.append(entry)
            page_text_builder.append(char)
            global_offset_ref[0] += 1
        page_text_builder.append(" ")
        global_offset_ref[0] += 1


def persist_artifacts(
    *,
    pdf_path: Path,
    raw_text: str,
    layout: Dict,
    extracted: Dict,
) -> ExtractionArtifacts:
    """Write raw_text/layout/extracted outputs next to the PDF."""
    timestamp = int(time.time())
    base_name = pdf_path.stem
    parent = pdf_path.parent

    raw_text_path = parent / f"{base_name}_{timestamp}_raw_text.txt"
    layout_path = parent / f"{base_name}_{timestamp}_layout.json"
    extracted_path = parent / f"{base_name}_{timestamp}_extracted.json"

    raw_text_path.write_text(raw_text, encoding="utf-8")
    layout_path.write_text(json.dumps(layout, ensure_ascii=True, indent=2), encoding="utf-8")
    extracted_path.write_text(json.dumps(extracted, ensure_ascii=True, indent=2), encoding="utf-8")

    return ExtractionArtifacts(
        pdf_path=pdf_path,
        raw_text_path=raw_text_path,
        layout_path=layout_path,
        extracted_json_path=extracted_path,
        raw_text=raw_text,
    )
