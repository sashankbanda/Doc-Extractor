import { useRef, useState } from "react";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import PdfViewer from "./PdfViewer.jsx";
import { uploadPdf } from "./api.js";

function AppHeader({ title, subtitle }) {
  return (
    <header className="app-header">
      <div className="logo-group">
        <div className="logo-icon">DE</div>
        <div>
          <p className="eyebrow">{subtitle}</p>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="header-actions">
        <button type="button" className="icon-btn">?</button>
        <button type="button" className="icon-btn">⌘</button>
      </div>
    </header>
  );
}

function Layout({ title, subtitle, children }) {
  return (
    <div className="app-frame">
      <AppHeader title={title} subtitle={subtitle} />
      <main className="screen-content">{children}</main>
    </div>
  );
}

function UploadPage() {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [rawPreview, setRawPreview] = useState("");
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const handleFileChange = (event) => {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setError("");
    setRawPreview("");
  };

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
    try {
      const result = await uploadPdf(formData);
      setRawPreview(result.raw_text?.slice(0, 1000) ?? "");
      const search = new URLSearchParams({
        pdf: result.pdf_path,
        json: result.json_path,
      }).toString();
      navigate(`/viewer?${search}`, { state: result });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const openPicker = () => fileInputRef.current?.click();
  const handleDragAreaKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  };
  const fileStatus = file
    ? {
        name: file.name,
        status: isUploading ? "processing" : "ready",
        size: `${(file.size / 1024).toFixed(1)} KB`,
      }
    : null;

  return (
    <section className="upload-screen">
      <div className="upload-card premium-card">
        <form className="upload-form" onSubmit={handleSubmit}>
          <div className="upload-card__header">
            <p className="eyebrow">Step 1 · Intake</p>
            <h2>Upload Documents</h2>
            <p className="muted">Drag & drop PDF, Excel, or CSV files to start the extraction run.</p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.xls,.xlsx,.csv"
            className="visually-hidden"
            onChange={handleFileChange}
          />

          <div
            className="drag-area"
            role="button"
            tabIndex={0}
            onClick={openPicker}
            onKeyDown={handleDragAreaKeyDown}
          >
            <div className="drag-graphic">↑</div>
            <div>
              <strong>Drop files here</strong>
              <p className="muted">or click to browse</p>
            </div>
          </div>

          <div className="file-list">
            {fileStatus ? (
              <div className="file-row">
                <div className="file-icon">{fileStatus.name.split(".").pop()?.toUpperCase()}</div>
                <div className="file-meta">
                  <strong>{fileStatus.name}</strong>
                  <span>{fileStatus.size}</span>
                </div>
                <div className={`status-dot ${fileStatus.status}`} />
              </div>
            ) : (
              <p className="file-placeholder">No files queued yet.</p>
            )}
          </div>

          <div className="upload-actions">
            <button type="button" className="btn-secondary" onClick={openPicker}>
              Browse Files
            </button>
            <button type="submit" className="btn-primary" disabled={!file || isUploading}>
              {isUploading ? "Analyzing…" : "Start Extraction"}
            </button>
          </div>

          {error ? <p className="error banner">{error}</p> : null}
        </form>
      </div>

      {rawPreview ? (
        <div className="preview-card">
          <div className="preview-header">
            <p className="eyebrow">Quick Peek</p>
            <strong>Raw Text Preview</strong>
          </div>
          <pre>{rawPreview}</pre>
        </div>
      ) : null}
    </section>
  );
}

function UploadRoute() {
  return (
    <Layout title="Document Extractor" subtitle="Premium Workspace">
      <UploadPage />
    </Layout>
  );
}

function ViewerRoute() {
  return (
    <Layout title="Review Workspace" subtitle="Synchronized View">
      <PdfViewer />
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<UploadRoute />} />
        <Route path="/viewer" element={<ViewerRoute />} />
      </Routes>
    </BrowserRouter>
  );
}
