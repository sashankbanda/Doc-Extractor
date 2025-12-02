import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/build/pdf";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { fileUrl } from "./api.js";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "./components/ui/Accordion.jsx";

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

/* =========== ICONS =========== */
const SearchIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export default function PdfViewer() {
  const location = useLocation();
  const navigate = useNavigate();
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
  const [searchTerm, setSearchTerm] = useState("");

  const canvasRef = useRef(null);

  // Load PDF
  useEffect(() => {
    if (!pdfPath) return;
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
    return () => { isCancelled = true; };
  }, [pdfPath]);

  // Load fields
  useEffect(() => {
    if (!jsonPath) return;
    setLoadingFields(true);
    setError("");
    fetch(fileUrl(jsonPath))
      .then((res) => {
        if (!res.ok) throw new Error("Unable to fetch extracted fields");
        return res.json();
      })
      .then((data) => {
        setFields(data.fields ?? []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingFields(false));
  }, [jsonPath]);

  // Render page
  useEffect(() => {
    if (!pdfDoc || pageCount === 0) return;

    let isCancelled = false;
    const renderPage = async () => {
      const pageNumber = Math.min(Math.max(currentPage, 1), pageCount);
      const page = await pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      
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
    return () => { isCancelled = true; };
  }, [pdfDoc, pageCount, scale, currentPage]);

  const annotatedFields = useMemo(
    () => fields.map((field, index) => ({ ...field, _index: index })),
    [fields]
  );

  // Group fields by sections with accordion support
  const { cardSections, tableSections, allFieldsTable, accordionGroups, standaloneFields } = useMemo(() => {
    const cardMap = new Map();
    const tableMap = new Map();
    const allFields = [];
    const groupedFields = new Map(); // For accordion grouping
    const standalone = []; // Fields without group pattern

    annotatedFields.forEach((field) => {
      const label = field.label || "";
      
      // Add to all fields table
      allFields.push({
        displayLabel: prettify(label || `Field ${field._index + 1}`),
        field,
      });

      // Check for group pattern like "Claims[0] Claim Number" or "Claims[0].ClaimNumber"
      const groupMatch = label.match(/^([a-zA-Z0-9_\s]+)\[(\d+)\][\s.]*(.*)$/);
      if (groupMatch) {
        const [, groupNameRaw, rowIndex, fieldNameRaw] = groupMatch;
        const groupName = groupNameRaw.trim();
        const groupKey = `${groupName}[${rowIndex}]`;
        const fieldName = prettify(fieldNameRaw || "Value");
        
        if (!groupedFields.has(groupKey)) {
          groupedFields.set(groupKey, {
            groupName,
            rowIndex: parseInt(rowIndex, 10),
            fields: [],
          });
        }
        groupedFields.get(groupKey).fields.push({
          displayLabel: fieldName,
          field,
        });
        return;
      }

      // Check for table pattern (legacy)
      const tableMatch = label.match(/^([a-zA-Z0-9_]+)\[(\d+)]\.(.+)$/);
      if (tableMatch) {
        const [, groupRaw, rowIndex, colRaw] = tableMatch;
        const groupName = prettify(groupRaw);
        const columnName = prettify(colRaw);
        if (!tableMap.has(groupName)) {
          tableMap.set(groupName, { columns: new Set(), rows: new Map() });
        }
        const table = tableMap.get(groupName);
        table.columns.add(columnName);
        const row = table.rows.get(rowIndex) ?? new Map();
        row.set(columnName, { value: field.value, field });
        table.rows.set(rowIndex, row);
        return;
      }

      // Check for dot-separated groups
      const [maybeGroup, maybeField] = label.split(".", 2);
      if (maybeField) {
        const groupName = prettify(maybeGroup);
        const displayLabel = prettify(maybeField);
        if (!cardMap.has(groupName)) cardMap.set(groupName, []);
        cardMap.get(groupName).push({ displayLabel, field });
      } else {
        // Standalone field
        standalone.push({
          displayLabel: prettify(label || `Field ${field._index + 1}`),
          field,
        });
      }
    });

    // Convert grouped fields to accordion format, sorted by group name then row index
    const accordions = Array.from(groupedFields.entries())
      .sort((a, b) => {
        const aData = a[1];
        const bData = b[1];
        const nameCompare = aData.groupName.localeCompare(bData.groupName);
        if (nameCompare !== 0) return nameCompare;
        return aData.rowIndex - bData.rowIndex;
      })
      .map(([key, data]) => ({
        key,
        title: `${prettify(data.groupName)} ${data.rowIndex}`,
        groupName: data.groupName,
        rowIndex: data.rowIndex,
        fields: data.fields,
      }));

    const cards = Array.from(cardMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([title, items]) => ({ title, items }));

    const tables = Array.from(tableMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([title, table]) => ({
        title,
        columns: Array.from(table.columns).sort((a, b) => a.localeCompare(b)),
        rows: Array.from(table.rows.entries())
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([rowIndex, row]) => ({ rowIndex, row })),
      }));

    return { 
      cardSections: cards, 
      tableSections: tables, 
      allFieldsTable: allFields,
      accordionGroups: accordions,
      standaloneFields: standalone,
    };
  }, [annotatedFields]);

  // Filter fields by search
  const filteredCardSections = useMemo(() => {
    if (!searchTerm) return cardSections;
    const term = searchTerm.toLowerCase();
    return cardSections
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) =>
            item.displayLabel.toLowerCase().includes(term) ||
            (item.field.value || "").toLowerCase().includes(term)
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [cardSections, searchTerm]);

  // Filter all fields table by search
  const filteredAllFields = useMemo(() => {
    if (!searchTerm) return allFieldsTable;
    const term = searchTerm.toLowerCase();
    return allFieldsTable.filter(
      (item) =>
        item.displayLabel.toLowerCase().includes(term) ||
        (item.field.value || "").toLowerCase().includes(term)
    );
  }, [allFieldsTable, searchTerm]);

  // Filter accordion groups by search
  const filteredAccordionGroups = useMemo(() => {
    if (!searchTerm) return accordionGroups;
    const term = searchTerm.toLowerCase();
    return accordionGroups
      .map((group) => ({
        ...group,
        fields: group.fields.filter(
          (item) =>
            item.displayLabel.toLowerCase().includes(term) ||
            (item.field.value || "").toLowerCase().includes(term) ||
            group.title.toLowerCase().includes(term)
        ),
      }))
      .filter((group) => group.fields.length > 0);
  }, [accordionGroups, searchTerm]);

  // Filter standalone fields by search
  const filteredStandaloneFields = useMemo(() => {
    if (!searchTerm) return standaloneFields;
    const term = searchTerm.toLowerCase();
    return standaloneFields.filter(
      (item) =>
        item.displayLabel.toLowerCase().includes(term) ||
        (item.field.value || "").toLowerCase().includes(term)
    );
  }, [standaloneFields, searchTerm]);

  const handleSelectField = (field) => {
    setSelectedFieldIndex(field._index);
    const firstRect = field.rects?.[0];
    if (!firstRect) return;
    setCurrentPage(firstRect.page + 1);
    setPendingHighlight({
      fieldIndex: field._index,
      page: firstRect.page,
      rectIndex: 0,
    });
  };

  // Scroll to highlight when page loads
  useEffect(() => {
    if (!pendingHighlight) return;
    if (pendingHighlight.page + 1 !== currentPage) return;
    
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
      if (pageCount === 0) return prev;
      const tentative = prev + delta;
      return Math.min(pageCount, Math.max(1, tentative));
    });
  };

  const currentPageKey = currentPage - 1;
  const selectedField = selectedFieldIndex == null 
    ? null 
    : annotatedFields.find((f) => f._index === selectedFieldIndex);

  const highlightRects = useMemo(() => {
    if (!selectedField?.rects) return [];
    return selectedField.rects
      .filter((rect) => rect.page === currentPageKey)
      .map((rect, rectIndex) => ({ rect, fieldIndex: selectedFieldIndex, rectIndex }));
  }, [selectedField, currentPageKey, selectedFieldIndex]);

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
    <div className="workspace">
      {/* Left Panel: PDF Viewer */}
      <aside className="panel-left">
        <div className="viewer-toolbar">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              Page {pageCount ? `${currentPage} / ${pageCount}` : "–"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="icon-btn"
              style={{ width: 32, height: 32 }}
              onClick={() => stepPage(-1)}
              disabled={!hasPrev}
            >
              ‹
            </button>
            <button
              type="button"
              className="icon-btn"
              style={{ width: 32, height: 32 }}
              onClick={() => stepPage(1)}
              disabled={!hasNext}
            >
              ›
            </button>
            <div style={{ width: 1, height: 24, background: "var(--border)", margin: "0 8px" }} />
            <button
              type="button"
              className="icon-btn"
              style={{ width: 32, height: 32 }}
              onClick={() => adjustZoom(-0.1)}
            >
              -
            </button>
            <span style={{ minWidth: 48, textAlign: "center", fontWeight: 600 }}>
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              className="icon-btn"
              style={{ width: 32, height: 32 }}
              onClick={() => adjustZoom(0.1)}
            >
              +
            </button>
          </div>
        </div>
        <div className="doc-canvas">
          <div className="doc-canvas-inner">
            {loadingPdf ? (
              <p className="muted">Rendering PDF…</p>
            ) : pageCount === 0 ? (
              <p className="muted">PDF ready once processed.</p>
            ) : null}
            <div className="page-stage">
              <canvas ref={canvasRef} />
              <div className="overlay">
                {highlightRects.map(({ rect, fieldIndex, rectIndex }) => {
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
        </div>
      </aside>

      {/* Right Panel: Data */}
      <section className="panel-right">
        <div className="data-header">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3>Extracted Data Points</h3>
            <button
              className="btn btn-primary"
              style={{ padding: "6px 12px", fontSize: 12 }}
              onClick={() => navigate("/summary")}
            >
              Finish Review
            </button>
          </div>
          <div className="search-box">
            <span className="search-icon">
              <SearchIcon />
            </span>
            <input
              type="text"
              placeholder="Search values, claims, or dates..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="data-scroll-area">
          <div className="data-scroll-inner">
            {loadingFields && <span className="badge">Loading…</span>}

            {filteredAccordionGroups.length === 0 && filteredStandaloneFields.length === 0 && filteredCardSections.length === 0 && !loadingFields ? (
              <div className="viewer-empty">
                <p className="muted">No structured fields available.</p>
              </div>
            ) : null}

            {/* Standalone Fields (non-grouped) */}
            {filteredStandaloneFields.length > 0 && (
              <div className="table-section">
                <div className="section-header">
                  <h3>General Fields ({filteredStandaloneFields.length})</h3>
                </div>
                <div className="table-wrapper">
                  <table className="accordion-table">
                    <tbody>
                      {filteredStandaloneFields.map(({ displayLabel, field }) => {
                        const isActive = selectedFieldIndex === field._index;
                        const hasLocation = field.rects && field.rects.length > 0;
                        return (
                          <tr
                            key={field._index}
                            className={`${isActive ? "active" : ""} ${hasLocation ? "clickable" : ""}`}
                            onClick={() => hasLocation && handleSelectField(field)}
                          >
                            <td className="field-name">{displayLabel}</td>
                            <td className={`field-value ${isActive ? "active" : ""}`}>
                              {field.value || "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Accordion Groups (Claims[0], Claims[1], etc.) */}
            {filteredAccordionGroups.length > 0 && (
              <Accordion type="single" collapsible>
                {filteredAccordionGroups.map((group) => (
                  <AccordionItem key={group.key} value={group.key}>
                    <AccordionTrigger>
                      <span className="group-badge">{group.rowIndex}</span>
                      {prettify(group.groupName)}
                      <span className="group-count">({group.fields.length} fields)</span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <table className="accordion-table">
                        <tbody>
                          {group.fields.map(({ displayLabel, field }) => {
                            const isActive = selectedFieldIndex === field._index;
                            const hasLocation = field.rects && field.rects.length > 0;
                            return (
                              <tr
                                key={field._index}
                                className={`${isActive ? "active" : ""} ${hasLocation ? "clickable" : ""}`}
                                onClick={() => hasLocation && handleSelectField(field)}
                              >
                                <td className="field-name">{displayLabel}</td>
                                <td className={`field-value ${isActive ? "active" : ""}`}>
                                  {field.value || "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}

            {/* Grouped Card Sections */}
            {filteredCardSections.map((section) => (
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

            {/* Table Sections */}
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

            {error && <p className="error">{error}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
