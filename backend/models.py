from __future__ import annotations

from pathlib import Path
from typing import List, Optional

from pydantic import BaseModel, Field


class FieldRect(BaseModel):
    page: int
    x0: float
    y0: float
    x1: float
    y1: float
    page_width: float
    page_height: float


class ExtractedField(BaseModel):
    label: str
    value: str
    snippet: Optional[str] = None
    rects: List[FieldRect] = Field(default_factory=list)


class ExtractionArtifacts(BaseModel):
    pdf_path: Path
    raw_text_path: Path
    layout_path: Path
    extracted_json_path: Path
    raw_text: str


class UploadResponse(BaseModel):
    pdf_path: str
    raw_text: str
    json_path: str
