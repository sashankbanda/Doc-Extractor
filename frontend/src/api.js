const DEFAULT_BASE = "http://localhost:8001/api";
const API_BASE = import.meta.env.VITE_API_BASE || DEFAULT_BASE;

const sanitizePath = (name) => encodeURIComponent(name ?? "");

export async function uploadPdf(formData) {
  const response = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Upload failed");
  }

  return response.json();
}

export function fileUrl(fileName) {
  if (!fileName) {
    return "";
  }
  return `${API_BASE}/file/${sanitizePath(fileName)}`;
}
