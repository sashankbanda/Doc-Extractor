# PDF Extraction + AI Structuring App

End-to-end document ingestion stack using FastAPI, pdfplumber, PyMuPDF, EasyOCR, Groq LLMs, and a React + PDF.js viewer.

## Features
- Upload PDFs and persist originals plus generated artifacts inside `backend/uploads/`.
- Hybrid extraction pipeline: pdfplumber for structured text/bboxes, EasyOCR fallback for image-only pages, PyMuPDF for page geometry.
- Groq-hosted LLM call (Llama 3.1 70B) to normalize key fields.
- Coordinate mapper stitches structured values back to per-character bounding boxes for highlight rendering.
- React viewer overlays highlights on top of PDF pages using PDF.js with sidebar navigation.

## Backend Setup (FastAPI)
1. **Install deps**
   ```cmd
   cd backend
   pip install -r requirements.txt
   ```
2. **Environment**
   - Set `GROQ_API_KEY` in your shell before running the server.
   - First EasyOCR run downloads models (~80 MB) to the user cache.
3. **Run API**
   ```cmd
   cd ..
   uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
   ```
   Or from the backend directory:
   ```cmd
   python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```
4. **Endpoints**
   - `POST /api/upload` → handles PDF upload, extraction pipeline, Groq structuring.
   - `GET /api/file/{name}` → serves any stored artifact (PDF, raw text, layout, extracted JSON).

## Frontend Setup (Vite + React)
1. ```cmd
   cd frontend
   npm install
   ```
2. Optional: copy `.env.example` to `.env` and adjust:
   - `VITE_API_BASE=/api` keeps the front-end talking to the Vite dev proxy.
   - `VITE_API_PROXY_TARGET=http://localhost:8000` tells the proxy where your FastAPI server is running.
   - For production builds, set `VITE_API_BASE` to the public FastAPI URL.
3. Start dev server:
   ```cmd
   npm run dev 
   ```
4. Visit the shown Vite URL (default `http://localhost:5173`). The dev server now proxies `/api/*` to the backend, so no extra CORS configuration is required during local development (just keep FastAPI listening on port 8000 and serving `/api/...` routes).

## Usage Flow
1. Go to the Upload page, choose a PDF, click **Upload & Extract**.
2. Backend stores outputs under `backend/uploads/` and returns filenames plus raw text.
3. UI automatically opens the viewer (`/viewer?pdf=...&json=...`).
4. Viewer fetches the PDF + `*_extracted.json`, renders pages with PDF.js, and paints rectangles over every mapped field. Click a field in the sidebar to jump to its highlight.

## Repository Layout
```
backend/
  main.py          # FastAPI app + routes
  extractor.py     # pdfplumber/PyMuPDF/EasyOCR pipeline + persistence helpers
  structurer.py    # Groq API call + response normalization
  mapper.py        # Snippet → bbox resolver
  models.py        # Pydantic models for API + persistence
  uploads/         # Runtime artifacts (.pdf/.txt/.json)
frontend/
  src/
    App.jsx        # Routing + upload page
    PdfViewer.jsx  # PDF.js canvas renderer + overlays
    api.js         # REST helpers
    index.css      # UI styles
    main.jsx       # React entry
  index.html
README.md
```

## Notes
- No Docker/Celery/Redis/queues required; everything runs in-process.
- The Groq call is best-effort. If the API key is missing or the request fails, the response falls back to an empty field list so the rest of the pipeline still completes.
- OCR is only invoked for pages without vector text to keep processing time reasonable.
