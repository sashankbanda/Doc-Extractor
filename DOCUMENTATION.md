# 📑 Document Extractor - Complete Application Flow

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React + Vite)                        │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                     │
│  │ Upload Page │ → │  PDF Viewer  │ → │Summary Page │                      │
│  └─────────────┘    └─────────────┘    └─────────────┘                     │
│         ↓                  ↑                                                │
│    api.js (fetch)    PDF.js + Highlights                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                              ↓ HTTP POST /api/upload
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (FastAPI)                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   main.py   │ → │ extractor.py│ → │structurer.py│ → │  mapper.py  │   │
│  │  (Routes)   │    │ (PDF Parse) │    │ (Groq LLM)  │    │(Coordinates)│  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                              ↓
                       ┌─────────────┐
                       │   GROQ API  │
                       │ (LLaMA 3.3) │
                       └─────────────┘
```

---

## 🔧 Backend Logic

### 1. `main.py` - FastAPI Server (Entry Point)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/api/upload` | POST | Upload PDF & extract data |
| `/api/file/{name}` | GET | Serve files (PDF, JSON) |

**Upload Flow:**
```python
# POST /api/upload
1. Validate file is PDF
2. Save to uploads/{timestamp}_{filename}
3. Extract raw text + layout → extractor.py
4. Structure with LLM → structurer.py
5. Map to coordinates → mapper.py
6. Save artifacts (text, layout, extracted JSON)
7. Return { pdf_path, raw_text, json_path }
```

---

### 2. `extractor.py` - PDF Text & Layout Extraction

**Libraries Used:**
- `pdfplumber` - Text extraction with character positions
- `PyMuPDF (fitz)` - OCR fallback for scanned pages
- `EasyOCR` - Image-based text recognition

**Process:**
```
PDF File
    │
    ▼
┌─────────────────────────────────────────┐
│ extract_pdf(pdf_path)                   │
│ ├─ For each page:                       │
│ │   ├─ Has text? → pdfplumber chars     │
│ │   └─ No text?  → OCR with EasyOCR     │
│ ├─ Collect chars with coordinates:      │
│ │   {char, x0, y0, x1, y1, page,        │
│ │    global_offset}                     │
│ └─ Return: (raw_text, layout)           │
└─────────────────────────────────────────┘
```

**Output Structure:**
```python
raw_text = "Full document text..."
layout = {
  "pages": [
    {
      "width": 612.0,
      "height": 792.0,
      "chars": [
        {"char": "A", "x0": 72.0, "y0": 72.0, "x1": 80.0, "y1": 84.0, "page": 0, "global_offset": 0},
        ...
      ]
    }
  ]
}
```

---

### 3. `structurer.py` - LLM-Based Field Extraction

**Configuration:**
- **Model:** `llama-3.3-70b-versatile` (Groq)
- **Chunk Size:** 25,000 characters
- **Overlap:** 500 characters
- **Temperature:** 0.1 (deterministic)

**Process:**
```
Raw Text (e.g., 50,000 chars)
    │
    ▼
┌─────────────────────────────────────────┐
│ structure_with_groq(raw_text)           │
│ ├─ Split into chunks (25k each)         │
│ ├─ For each chunk:                      │
│ │   ├─ Send to Groq API with prompt     │
│ │   └─ Extract {label, value, snippet}  │
│ └─ Merge all fields                     │
└─────────────────────────────────────────┘
    │
    ▼
{
  "fields": [
    {"label": "Policy Number", "value": "POL-123", "snippet": "Policy Number: POL-123"},
    {"label": "Claims[0].Amount", "value": "$500", "snippet": "Amount $500"},
    ...
  ]
}
```

**LLM Prompt Strategy:**
- System prompt instructs extraction of ALL data
- `snippet` must be EXACT text from document (for coordinate mapping)
- Table data uses format: `TableName[row].ColumnName`

---

### 4. `mapper.py` - Field-to-Coordinate Mapping

**7-Level Matching Strategy:**

| # | Strategy | Description |
|---|----------|-------------|
| 1 | Exact snippet | Case-sensitive exact match |
| 2 | Exact value | Try matching the value directly |
| 3 | Case-insensitive snippet | Ignore case |
| 4 | Case-insensitive value | Ignore case on value |
| 5 | Normalized whitespace | Collapse multiple spaces |
| 6 | Normalized value | Same for value |
| 7 | Fuzzy match | Find longest matching substring |

**Process:**
```
Structured Fields + Raw Text + Layout
    │
    ▼
┌─────────────────────────────────────────┐
│ map_fields_to_rects(structured, text,   │
│                     layout)             │
│ For each field:                         │
│ ├─ Find text offset using strategies    │
│ ├─ Convert offset → char positions      │
│ └─ Generate bounding rectangles:        │
│    {page, x0, y0, x1, y1, page_width,   │
│     page_height}                        │
└─────────────────────────────────────────┘
    │
    ▼
{
  "fields": [
    {
      "label": "Policy Number",
      "value": "POL-123",
      "snippet": "Policy Number: POL-123",
      "rects": [
        {"page": 0, "x0": 100, "y0": 200, "x1": 300, "y1": 220, "page_width": 612, "page_height": 792}
      ]
    }
  ]
}
```

---

### 5. `models.py` - Pydantic Data Models

```python
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
    rects: List[FieldRect] = []

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
```

---

## 🎨 Frontend

### 1. `api.js` - API Client

```javascript
const API_BASE = "http://localhost:8001/api";

// Upload PDF and get extraction results
export async function uploadPdf(formData) {
  const response = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    body: formData,
  });
  return response.json();  // {pdf_path, raw_text, json_path}
}

// Generate URL for fetching files
export function fileUrl(fileName) {
  return `${API_BASE}/file/${encodeURIComponent(fileName)}`;
}
```

---

### 2. `App.jsx` - Main Application

**Routes:**

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `UploadPage` | File upload with drag & drop |
| `/viewer` | `PdfViewer` | PDF + extracted data review |
| `/summary` | `SummaryPage` | Final review & download |

**Key Components:**

#### UploadPage
- Drag & drop or browse for PDF files
- Progress modal with animated status
- On success, navigates to viewer

#### ProgressModal
- Shows extraction progress (simulated)
- Status messages: "Analyzing...", "Extracting...", "Processing with AI..."
- Completion state with "Review Data" button

#### SummaryPage
- Shows field count and accuracy
- Download Excel / View JSON buttons
- Start new extraction option

**Upload Flow:**
```
User drops PDF
    ↓
ProgressModal shows (simulated progress)
    ↓
uploadPdf() called
    ↓
On success → navigate to /viewer?pdf=...&json=...
```

---

### 3. `PdfViewer.jsx` - Main Workspace

**Features:**
- PDF rendering with PDF.js
- Page navigation & zoom controls
- Search/filter extracted fields
- Click-to-highlight field locations
- **Accordion grouping** for related fields (Claims[0], Claims[1], etc.)

**State Management:**
```javascript
const [pdfDoc, setPdfDoc] = useState(null);        // PDF.js document
const [fields, setFields] = useState([]);           // Extracted fields
const [selectedFieldIndex, setSelectedFieldIndex] = useState(null);
const [scale, setScale] = useState(1.1);           // Zoom level
const [currentPage, setCurrentPage] = useState(1);  // Current page
const [searchTerm, setSearchTerm] = useState("");   // Filter term
```

**Data Flow:**
```
┌─────────────────────────────────────────────────────────────────┐
│                        PdfViewer Component                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Load PDF (pdf.js)          2. Fetch extracted JSON          │
│     getDocument(fileUrl)          fetch(fileUrl(jsonPath))      │
│            ↓                              ↓                      │
│  ┌─────────────────┐           ┌─────────────────┐              │
│  │   pdfDoc state  │           │   fields state   │              │
│  └─────────────────┘           └─────────────────┘              │
│                                         │                        │
│  3. Group fields for display:           ↓                        │
│     ├─ standaloneFields (no pattern)                            │
│     ├─ accordionGroups (Claims[0], etc.)                        │
│     ├─ cardSections (Group.Field)                               │
│     └─ tableSections (legacy tables)                            │
│                                                                  │
│  4. On field click:                                              │
│     ├─ Set selectedFieldIndex                                   │
│     ├─ Navigate to field's page                                 │
│     └─ Render highlight overlay with rect coordinates           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Field Grouping Logic:**
```javascript
// Pattern: Claims[0].Claim_Number → grouped under "Claims[0]"
const groupMatch = label.match(/^([a-zA-Z0-9_\s]+)\[(\d+)\][\s.]*(.*)$/);

// Creates accordion groups:
accordionGroups = [
  {
    key: "Claims[0]",
    title: "Claims 0",
    fields: [{displayLabel: "Claim Number", field: {...}}, ...]
  },
  {
    key: "Claims[1]",
    title: "Claims 1",
    fields: [...]
  }
]
```

**Highlight Rendering:**
```jsx
// For selected field's rects on current page
{highlightRects.map(({rect, fieldIndex, rectIndex}) => {
  const style = {
    left: rect.x0 * scale,
    top: rect.y0 * scale,
    width: (rect.x1 - rect.x0) * scale,
    height: (rect.y1 - rect.y0) * scale,
  };
  return (
    <div 
      className="highlight active" 
      style={style}
      id={`highlight-${fieldIndex}-${rect.page}-${rectIndex}`}
    />
  );
})}
```

---

### 4. UI Components

#### `Accordion.jsx`
Collapsible sections for grouped fields:
- `Accordion` - Container with single/multiple expand modes
- `AccordionItem` - Individual collapsible section
- `AccordionTrigger` - Clickable header with chevron
- `AccordionContent` - Animated content area

#### `ScrollArea.jsx`
Custom scrollable container with styled scrollbars.

---

## 🔄 Complete Data Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            USER UPLOADS PDF                                   │
└──────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND: App.jsx → uploadPdf(formData) → POST /api/upload                   │
└──────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ BACKEND: main.py receives PDF                                                │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ 1. Save PDF to uploads/                                                  │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                    ↓                                          │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ 2. extractor.py: extract_pdf()                                           │ │
│ │    • pdfplumber extracts chars with coordinates                          │ │
│ │    • EasyOCR for scanned/image pages                                     │ │
│ │    → Returns: raw_text (string), layout (char positions)                 │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                    ↓                                          │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ 3. structurer.py: structure_with_groq()                                  │ │
│ │    • Chunks text (25k chars, 500 overlap)                                │ │
│ │    • Sends to Groq API (llama-3.3-70b-versatile)                         │ │
│ │    • LLM extracts {label, value, snippet} for each field                 │ │
│ │    → Returns: {fields: [...]}                                            │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                    ↓                                          │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ 4. mapper.py: map_fields_to_rects()                                      │ │
│ │    • For each field, find snippet in raw_text                            │ │
│ │    • Uses 7 matching strategies (exact → fuzzy)                          │ │
│ │    • Converts text offset → character positions → bounding rects         │ │
│ │    → Returns: fields with rects [{page, x0, y0, x1, y1, ...}]           │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                    ↓                                          │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ 5. persist_artifacts(): Save JSON files                                  │ │
│ │    • {base}_raw_text.txt                                                 │ │
│ │    • {base}_layout.json                                                  │ │
│ │    • {base}_extracted.json                                               │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ RESPONSE: {pdf_path, raw_text, json_path}                                    │
└──────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND: Navigate to /viewer?pdf={pdf_path}&json={json_path}                │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ PdfViewer.jsx:                                                           │ │
│ │ • Loads PDF with PDF.js → renders to canvas                              │ │
│ │ • Fetches extracted.json → displays in data panel                        │ │
│ │ • Groups fields: standalone, accordions (Claims[0], etc.), cards, tables │ │
│ │ • On field click: highlights with rect coordinates                       │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ USER: Reviews data, clicks fields to see highlights, finishes review        │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 File Structure

```
v2 simple tech/
├── .env                          # GROQ_API_KEY=your_key_here
├── .env.example                  # Template for .env
├── .gitignore
├── README.md
├── start_backend.bat             # Run: uvicorn backend.main:app --port 8001
├── start_frontend.bat            # Run: npm run dev
│
├── backend/
│   ├── __init__.py
│   ├── main.py                   # FastAPI routes (/api/upload, /api/file)
│   ├── extractor.py              # PDF text & layout extraction
│   ├── structurer.py             # LLM-based field extraction (Groq)
│   ├── mapper.py                 # Field-to-coordinate mapping
│   ├── models.py                 # Pydantic data models
│   ├── requirements.txt          # Python dependencies
│   └── uploads/                  # Saved PDFs and JSON artifacts
│       ├── {timestamp}_{file}.pdf
│       ├── {base}_raw_text.txt
│       ├── {base}_layout.json
│       └── {base}_extracted.json
│
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── main.jsx              # React entry point
        ├── App.jsx               # Routes + Upload page + Summary page
        ├── PdfViewer.jsx         # PDF viewer + data panel
        ├── api.js                # API client (uploadPdf, fileUrl)
        ├── index.css             # Global styles
        └── components/
            └── ui/
                ├── Accordion.jsx # Collapsible sections
                └── ScrollArea.jsx # Custom scrollable container
```

---

## 🔑 Key Technologies

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Backend** | FastAPI | REST API server with async support |
| **Backend** | pdfplumber | Text extraction with character positions |
| **Backend** | PyMuPDF (fitz) | PDF rendering for OCR fallback |
| **Backend** | EasyOCR | Image-based text recognition |
| **Backend** | Groq API | LLM inference (llama-3.3-70b-versatile) |
| **Backend** | Pydantic | Data validation and serialization |
| **Frontend** | React 18 | UI framework with hooks |
| **Frontend** | Vite | Fast build tool and dev server |
| **Frontend** | PDF.js | PDF rendering in browser |
| **Frontend** | React Router | Client-side routing |

---

## 🚀 Running the Application

### Prerequisites
- Python 3.9+
- Node.js 18+
- Groq API key

### Backend Setup
```bash
cd backend
pip install -r requirements.txt
# Set GROQ_API_KEY in .env file
uvicorn main:app --port 8001 --reload
```

### Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

### Or use batch files:
```bash
# Terminal 1
start_backend.bat

# Terminal 2
start_frontend.bat
```

---

## 🔐 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GROQ_API_KEY` | API key for Groq LLM service | Yes |
| `VITE_API_BASE` | Backend API URL (default: http://localhost:8001/api) | No |

---

## 📊 API Reference

### POST `/api/upload`

**Request:**
```
Content-Type: multipart/form-data
Body: file (PDF)
```

**Response:**
```json
{
  "pdf_path": "1701234567_document.pdf",
  "raw_text": "Full extracted text...",
  "json_path": "document_1701234567_extracted.json"
}
```

### GET `/api/file/{name}`

**Response:** File download (PDF or JSON)

---

## 🎯 Key Features

1. **Multi-format PDF Support**
   - Native text extraction for digital PDFs
   - OCR fallback for scanned documents

2. **Intelligent Field Extraction**
   - LLM-powered understanding of document structure
   - Handles tables, forms, and unstructured text

3. **Precise Highlighting**
   - 7-level matching for accurate text location
   - Click-to-highlight any extracted field

4. **Organized Data Display**
   - Accordion groups for related fields (Claims[0], Claims[1])
   - Search/filter functionality
   - Card and table layouts

5. **Responsive UI**
   - Zoom and page navigation
   - Scrollable panels with custom styling
   - Progress feedback during extraction
