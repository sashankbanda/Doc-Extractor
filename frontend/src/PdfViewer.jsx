import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/build/pdf";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { fileUrl } from "./api.js";

GlobalWorkerOptions.workerSrc = pdfjsWorker;

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.5;
const DEFAULT_SCALE = 1.1;

function useQueryParams() {
  const [searchParams] = useSearchParams();
  return Object.fromEntries(searchParams.entries());
}

const prettify = (label = "") =>
  label
    .replace(/_/g, " ")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase()) || "Field";

export default function PdfViewer() {
  const location = useLocation();
  const query = useQueryParams();
  const pdfPath = query.pdf || location.state?.pdf_path || location.state?.pdfPath;
  const jsonPath = query.json || location.state?.json_path || location.state?.jsonPath;

  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [fields, setFields] = useState([]);
  const [error, setError] = useState("");
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [selectedFieldIndex, setSelectedFieldIndex] = useState(null);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentPageDims, setCurrentPageDims] = useState(null);
  const [pendingHighlight, setPendingHighlight] = useState(null);

  const canvasRef = useRef(null);

  useEffect(() => {
    if (!pdfPath) {
      return;
    }
    setLoadingPdf(true);
    setError("");

    let isCancelled = false;
    const loadPdf = async () => {
      try {
        const doc = await getDocument(fileUrl(pdfPath)).promise;
        if (!isCancelled) {
          setPdfDoc(doc);
          setPageCount(doc.numPages);
          setCurrentPage(1);
        }
      } catch (err) {
        if (!isCancelled) {
          setError(`Failed to load PDF: ${err.message}`);
        }
      } finally {
        if (!isCancelled) {
          setLoadingPdf(false);
        }
      }
    };

    loadPdf();

    return () => {
      isCancelled = true;
    };
  }, [pdfPath]);

  useEffect(() => {
    if (!jsonPath) {
      return;
    }
    setLoadingFields(true);
    setError("");
    fetch(fileUrl(jsonPath))
      .then((res) => {
        if (!res.ok) {
          throw new Error("Unable to fetch extracted fields");
        }
        return res.json();
      })
      .then((data) => {
        setFields(data.fields ?? []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingFields(false));
  }, [jsonPath]);

  useEffect(() => {
    if (!pdfDoc || pageCount === 0) {
      return;
    }

    let isCancelled = false;
    const renderPage = async () => {
      const pageNumber = Math.min(Math.max(currentPage, 1), pageCount);
      const page = await pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const context = canvas.getContext("2d");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      await page.render({ canvasContext: context, viewport }).promise;
      if (!isCancelled) {
        setCurrentPageDims({
          width: viewport.width,
          height: viewport.height,
          scale,
          page: pageNumber,
        });
      }
    };

    renderPage();

    return () => {
      isCancelled = true;
    };
  }, [pdfDoc, pageCount, scale, currentPage]);

  const annotatedFields = useMemo(
    () => fields.map((field, index) => ({ ...field, _index: index })),
    [fields],
  );

  const fieldsByPage = useMemo(() => {
    const grouped = {};
    annotatedFields.forEach((field) => {
      (field.rects ?? []).forEach((rect, rectIndex) => {
        const bucket = grouped[rect.page] ?? [];
        bucket.push({ rect, fieldIndex: field._index, rectIndex });
        grouped[rect.page] = bucket;
      });
    });
    return grouped;
  }, [annotatedFields]);

  const { cardSections, tableSections } = useMemo(() => {
    const cardMap = new Map();
    const tableMap = new Map();

    annotatedFields.forEach((field) => {
      const label = field.label || "";
      const tableMatch = label.match(/^([a-zA-Z0-9_]+)\[(\d+)]\.(.+)$/);
      if (tableMatch) {
        const [, groupRaw, rowIndex, colRaw] = tableMatch;
        const groupName = prettify(groupRaw);
        const columnName = prettify(colRaw);
        if (!tableMap.has(groupName)) {
          tableMap.set(groupName, {
            columns: new Set(),
            rows: new Map(),
          });
        }
        const table = tableMap.get(groupName);
        table.columns.add(columnName);
        const row = table.rows.get(rowIndex) ?? new Map();
        row.set(columnName, { value: field.value, field });
        table.rows.set(rowIndex, row);
        return;
      }

      const [maybeGroup, maybeField] = label.split(".", 2);
      const groupName = maybeField ? prettify(maybeGroup) : "Key Fields";
      const displayLabel = prettify(maybeField || label || `Field ${field._index + 1}`);
      if (!cardMap.has(groupName)) {
        cardMap.set(groupName, []);
      }
      cardMap.get(groupName).push({ displayLabel, field });
    });

    const cards = Array.from(cardMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([title, items]) => ({
        title,
        items,
      }));

    const tables = Array.from(tableMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([title, table]) => ({
        title,
        columns: Array.from(table.columns).sort((a, b) => a.localeCompare(b)),
        rows: Array.from(table.rows.entries())
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([rowIndex, row]) => ({ rowIndex, row })),
      }));

    return { cardSections: cards, tableSections: tables };
  }, [annotatedFields]);

  const handleSelectField = (field) => {
    setSelectedFieldIndex(field._index);
    const firstRect = field.rects?.[0];
    if (!firstRect) {
      return;
    }
    setCurrentPage(firstRect.page + 1);
    setPendingHighlight({
      fieldIndex: field._index,
      page: firstRect.page,
      rectIndex: 0,
    });
  };

  useEffect(() => {
    if (!pendingHighlight) {
      return;
    }
    if (pendingHighlight.page + 1 !== currentPage) {
      return;
    }
    const id = `highlight-${pendingHighlight.fieldIndex}-${pendingHighlight.page}-${pendingHighlight.rectIndex}`;
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.add("pulse");
      setTimeout(() => element.classList.remove("pulse"), 800);
      setPendingHighlight(null);
    }
  }, [pendingHighlight, currentPage, currentPageDims]);

  const adjustZoom = (delta) => {
    setScale((current) => {
      const tentative = Number((current + delta).toFixed(2));
      return Math.min(MAX_SCALE, Math.max(MIN_SCALE, tentative));
    });
  };

  const stepPage = (delta) => {
    setCurrentPage((prev) => {
      if (pageCount === 0) {
        return prev;
      }
      const tentative = prev + delta;
      return Math.min(pageCount, Math.max(1, tentative));
    });
  };

  const currentPageKey = currentPage - 1;
  const pageHighlights = fieldsByPage[currentPageKey] ?? [];
  const selectedHighlights = selectedFieldIndex == null
    ? []
    : pageHighlights.filter(({ fieldIndex }) => fieldIndex === selectedFieldIndex);
  const hasPrev = currentPage > 1;
  const hasNext = pageCount > 0 && currentPage < pageCount;

  if (!pdfPath || !jsonPath) {
    return (
      <div className="viewer-empty">
        <p>Please upload a PDF first.</p>
      </div>
    );
  }

  return (
    <div className="workspace-screen">
      <section className="workspace-panel panel-left">
        <header className="panel-toolbar">
          <div>
            <p className="eyebrow">Document</p>
            <strong>Page {pageCount ? `${currentPage} / ${pageCount}` : "–"}</strong>
          </div>
          <div className="panel-controls">
            <button type="button" className="icon-btn" onClick={() => stepPage(-1)} disabled={!hasPrev}>
              ‹
            </button>
            <button type="button" className="icon-btn" onClick={() => stepPage(1)} disabled={!hasNext}>
              ›
            </button>
            <div className="divider" aria-hidden="true" />
            <button type="button" className="icon-btn" onClick={() => adjustZoom(-0.1)}>-</button>
            <span className="scale-readout">{Math.round(scale * 100)}%</span>
            <button type="button" className="icon-btn" onClick={() => adjustZoom(0.1)}>+</button>
          </div>
        </header>
        <div className="panel-body panel-body--doc" aria-live="polite">
          {loadingPdf ? <p className="muted">Rendering PDF…</p> : null}
          {!loadingPdf && pageCount === 0 ? <p className="muted">PDF ready once processed.</p> : null}
          <div className="page-stage">
            <canvas ref={canvasRef} />
            <div className="overlay">
              {selectedHighlights.map(({ rect, fieldIndex, rectIndex }) => {
                const dims = currentPageDims?.page === currentPage ? currentPageDims : null;
                const widthScale = dims ? dims.width / rect.page_width : scale;
                const heightScale = dims ? dims.height / rect.page_height : scale;
                const style = {
                  left: rect.x0 * widthScale,
                  top: rect.y0 * heightScale,
                  width: (rect.x1 - rect.x0) * widthScale,
                  height: (rect.y1 - rect.y0) * heightScale,
                };
                const id = `highlight-${fieldIndex}-${rect.page}-${rectIndex}`;
                return (
                  <div
                    key={id}
                    id={id}
                    className="highlight active"
                    style={style}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="workspace-panel panel-right">
        <header className="panel-toolbar">
          <div>
            <p className="eyebrow">Structured Data</p>
            <strong>Click a field to sync the highlight</strong>
          </div>
          {loadingFields ? <span className="badge">Loading…</span> : null}
        </header>
        <div className="panel-tip">
          <strong>Tip</strong>
          <p>Use the cards or table rows to jump straight to the matching region on the PDF.</p>
        </div>
        <div className="panel-body panel-body--data">
          {cardSections.length === 0 && tableSections.length === 0 && !loadingFields ? (
            <p className="muted">No structured fields available.</p>
          ) : null}

          {cardSections.map((section) => (
            <div className="card-section" key={section.title}>
              <div className="section-header">
                <h3>{section.title}</h3>
              </div>
              <div className="card-grid">
                {section.items.map(({ displayLabel, field }) => (
                  <button
                    type="button"
                    key={`${field._index}-${displayLabel}`}
                    className={`field-card ${selectedFieldIndex === field._index ? "active" : ""}`}
                    onClick={() => handleSelectField(field)}
                  >
                    <span className="field-label">{displayLabel}</span>
                    <span className="field-value">{field.value || "—"}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {tableSections.map((section) => (
            <div className="table-section" key={section.title}>
              <div className="section-header">
                <h3>{section.title}</h3>
              </div>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      {section.columns.map((col) => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map(({ rowIndex, row }) => (
                      <tr key={rowIndex}>
                        {section.columns.map((col) => {
                          const cell = row.get(col);
                          const value = cell?.value ?? "—";
                          const field = cell?.field;
                          const isActive = field && selectedFieldIndex === field._index;
                          return (
                            <td
                              key={`${rowIndex}-${col}`}
                              className={isActive ? "active" : ""}
                              onClick={() => field && handleSelectField(field)}
                            >
                              {value}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {error ? <p className="error">{error}</p> : null}
        </div>
      </section>
    </div>
  );
}
