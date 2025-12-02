import { useCallback, useRef, useState } from "react";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import PdfViewer from "./PdfViewer.jsx";
import { uploadPdf } from "./api.js";

/* =========== ICONS =========== */
const UploadIcon = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ marginBottom: 16 }}
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const SpinnerIcon = () => (
  <svg
    className="spinner"
    width="40"
    height="40"
    viewBox="0 0 24 24"
    fill="none"
    stroke="var(--primary)"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

const CheckCircleIcon = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const CheckIcon = () => (
  <svg
    width="40"
    height="40"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/* =========== HEADER =========== */
function AppHeader({ title }) {
  return (
    <header>
      <div className="logo-group">
        <div className="logo-icon">DE</div>
        <h1>{title}</h1>
      </div>
      <div className="header-actions">
        <button type="button" className="icon-btn">
          ?
        </button>
        <button type="button" className="icon-btn">
          ⌘
        </button>
      </div>
    </header>
  );
}

/* =========== PROGRESS MODAL =========== */
function ProgressModal({ isVisible, progress, statusText, isComplete, onReviewData }) {
  return (
    <div className={`modal-overlay ${isVisible ? "" : "hidden"}`}>
      <div className="progress-card">
        {!isComplete ? (
          <div>
            <div style={{ marginBottom: 20 }}>
              <SpinnerIcon />
            </div>
            <h2 style={{ margin: 0, fontSize: 20 }}>Extracting Data</h2>
            <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
              {statusText}
            </p>
            <div className="progress-bar-track">
              <div
                className="progress-bar-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mono" style={{ color: "var(--primary)" }}>
              {Math.floor(progress)}%
            </div>
          </div>
        ) : (
          <div>
            <div style={{ color: "var(--secondary)", marginBottom: 20 }}>
              <CheckCircleIcon />
            </div>
            <h2 style={{ margin: 0, fontSize: 20 }}>Extraction Complete</h2>
            <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
              All fields successfully identified.
            </p>
            <button
              className="btn btn-primary"
              style={{ marginTop: 24, width: "100%" }}
              onClick={onReviewData}
            >
              Review Data
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* =========== UPLOAD PAGE =========== */
function UploadPage() {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Analyzing document structure...");
  const [isComplete, setIsComplete] = useState(false);
  const [extractionResult, setExtractionResult] = useState(null);

  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const handleFileChange = (event) => {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setError("");
  };

  const simulateProgress = useCallback(() => {
    const statusMessages = [
      "Analyzing document structure...",
      "Extracting text content...",
      "Running OCR on images...",
      "Processing with AI model...",
      "Mapping field coordinates...",
      "Finalizing extraction..."
    ];

    let currentProgress = 0;
    const interval = setInterval(() => {
      currentProgress += Math.random() * 8 + 2;
      if (currentProgress > 95) currentProgress = 95;
      
      setProgress(currentProgress);
      const messageIndex = Math.floor((currentProgress / 100) * statusMessages.length);
      setStatusText(statusMessages[Math.min(messageIndex, statusMessages.length - 1)]);
    }, 200);

    return interval;
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!file) {
      setError("Please choose a PDF file first");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    
    setIsUploading(true);
    setError("");
    setShowModal(true);
    setProgress(0);
    setIsComplete(false);
    
    const progressInterval = simulateProgress();

    try {
      const result = await uploadPdf(formData);
      clearInterval(progressInterval);
      setProgress(100);
      setStatusText("Complete!");
      setExtractionResult(result);
      
      setTimeout(() => {
        setIsComplete(true);
      }, 500);
    } catch (err) {
      clearInterval(progressInterval);
      setShowModal(false);
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleReviewData = () => {
    if (extractionResult) {
      const search = new URLSearchParams({
        pdf: extractionResult.pdf_path,
        json: extractionResult.json_path,
      }).toString();
      navigate(`/viewer?${search}`, { state: extractionResult });
    }
  };

  const openPicker = () => fileInputRef.current?.click();

  const fileStatus = file
    ? {
        name: file.name,
        status: isUploading ? "processing" : "ready",
        size: `${(file.size / 1024).toFixed(1)} KB`,
        type: file.name.split(".").pop()?.toUpperCase() || "FILE",
      }
    : null;

  return (
    <>
      <ProgressModal
        isVisible={showModal}
        progress={progress}
        statusText={statusText}
        isComplete={isComplete}
        onReviewData={handleReviewData}
      />

      <section className="upload-screen">
        <div className="upload-card">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.xls,.xlsx,.csv"
            className="hidden"
            onChange={handleFileChange}
          />

          <div
            className="drag-drop-area"
            role="button"
            tabIndex={0}
            onClick={openPicker}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openPicker();
              }
            }}
          >
            <UploadIcon />
            <h3 style={{ margin: 0, fontSize: 18 }}>Upload Documents</h3>
            <p className="muted" style={{ margin: "8px 0 0 0", fontSize: 14 }}>
              Drag & drop PDF, Excel, or CSV files
            </p>
          </div>

          <div className="file-list">
            {fileStatus ? (
              <div className="file-item">
                <div className="file-icon-box mono">{fileStatus.type}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>
                    {fileStatus.name}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      marginTop: 2,
                    }}
                  >
                    <span className={`status-dot ${fileStatus.status}`} />
                    {fileStatus.status === "processing" ? "Analyzing..." : "Ready"} · {fileStatus.size}
                  </div>
                </div>
                {!isUploading && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#666",
                      cursor: "pointer",
                      fontSize: 16,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ) : null}
          </div>

          <div className="upload-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={openPicker}
              style={{ fontSize: 12 }}
            >
              Browse Files
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={!file || isUploading}
            >
              Start Extraction
            </button>
          </div>

          {error && <div className="error-banner">{error}</div>}
        </div>
      </section>
    </>
  );
}

/* =========== SUMMARY PAGE =========== */
function SummaryPage({ fieldCount, onNewExtraction, onDownloadExcel, onViewJson }) {
  return (
    <section className="success-screen">
      <div className="success-card">
        <div className="success-icon-lg">
          <CheckIcon />
        </div>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Review Complete</h1>
        <p className="muted">
          The extracted data has been validated and formatted.
        </p>

        <div className="stats-grid">
          <div>
            <div className="stat-num">{fieldCount}</div>
            <div className="stat-label">Fields</div>
          </div>
          <div>
            <div className="stat-num" style={{ color: "var(--secondary)" }}>
              100%
            </div>
            <div className="stat-label">Accuracy</div>
          </div>
          <div>
            <div className="stat-num mono" style={{ fontSize: 24, paddingTop: 6 }}>
              JSON
            </div>
            <div className="stat-label">Format</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            className="btn btn-primary"
            style={{ minWidth: 160 }}
            onClick={onDownloadExcel}
          >
            Download Excel
          </button>
          <button
            className="btn btn-secondary"
            style={{ minWidth: 160 }}
            onClick={onViewJson}
          >
            View JSON
          </button>
        </div>
        <div style={{ marginTop: 24 }}>
          <button
            className="btn"
            style={{ color: "var(--text-muted)", fontSize: 13, background: "none", border: "none" }}
            onClick={onNewExtraction}
          >
            Start New Extraction
          </button>
        </div>
      </div>
    </section>
  );
}

/* =========== ROUTES =========== */
function UploadRoute() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <AppHeader title="Document Extractor" />
      <main className="screen-content">
        <UploadPage />
      </main>
    </div>
  );
}

function ViewerRoute() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <AppHeader title="Review Workspace" />
      <main className="screen-content">
        <PdfViewer />
      </main>
    </div>
  );
}

function SummaryRoute() {
  const navigate = useNavigate();
  
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <AppHeader title="Summary" />
      <main className="screen-content">
        <SummaryPage
          fieldCount={22}
          onNewExtraction={() => navigate("/")}
          onDownloadExcel={() => alert("Download Excel feature coming soon!")}
          onViewJson={() => alert("View JSON feature coming soon!")}
        />
      </main>
    </div>
  );
}

/* =========== APP =========== */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<UploadRoute />} />
        <Route path="/viewer" element={<ViewerRoute />} />
        <Route path="/summary" element={<SummaryRoute />} />
      </Routes>
    </BrowserRouter>
  );
}
