from __future__ import annotations

import shutil
import time
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

try:
    from .extractor import extract_pdf, persist_artifacts
    from .mapper import map_fields_to_rects
    from .models import UploadResponse
    from .structurer import structure_with_groq
except ImportError:
    from extractor import extract_pdf, persist_artifacts
    from mapper import map_fields_to_rects
    from models import UploadResponse
    from structurer import structure_with_groq

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="PDF Extraction API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"message": "PDF Extraction API", "status": "running"}


@app.post("/api/upload", response_model=UploadResponse)
async def upload_pdf(file: Annotated[UploadFile, File(...)]):
    if file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    timestamp = int(time.time())
    sanitized_name = file.filename or "document.pdf"
    target_name = f"{timestamp}_{Path(sanitized_name).name}"
    target_path = UPLOAD_DIR / target_name

    with target_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    raw_text, layout = extract_pdf(target_path)
    structured = structure_with_groq(raw_text)
    mapped = map_fields_to_rects(structured, raw_text, layout)

    artifacts = persist_artifacts(
        pdf_path=target_path,
        raw_text=raw_text,
        layout=layout,
        extracted=mapped,
    )

    return UploadResponse(
        pdf_path=artifacts.pdf_path.name,
        raw_text=artifacts.raw_text,
        json_path=artifacts.extracted_json_path.name,
    )


@app.get("/api/file/{name}")
async def get_file(name: str):
    safe_name = Path(name).name
    file_path = UPLOAD_DIR / safe_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=file_path)
