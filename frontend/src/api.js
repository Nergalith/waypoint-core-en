const BASE = "http://127.0.0.1:8000";

export async function getLfi() {
  const r = await fetch(`${BASE}/api/lfi`);
  if (!r.ok) throw new Error("Failed to load LFI");
  return r.json();
}

export async function finalizeLfi(id, lang = "en") {
  const r = await fetch(`${BASE}/api/lfi/${id}/finalize?lang=${encodeURIComponent(lang)}`, { method: "PATCH" });
  if (!r.ok) throw new Error("Failed to finalize report");
  return r.json();
}

export async function reopenLfi(id) {
  const r = await fetch(`${BASE}/api/lfi/${id}/reopen`, { method: "PATCH" });
  if (!r.ok) throw new Error("Failed to reopen report");
  return r.json();
}

export async function createLfi(payload) {
  const r = await fetch(`${BASE}/api/lfi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error("Failed to save LFI report");
  return r.json();
}

export async function updateLfi(id, payload) {
  const r = await fetch(`${BASE}/api/lfi/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error("Failed to update LFI report");
  return r.json();
}

export async function deleteLfi(id) {
  const r = await fetch(`${BASE}/api/lfi/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Delete failed");
  return r.json();
}

export async function getPhotos() {
  const r = await fetch(`${BASE}/api/photos`);
  if (!r.ok) throw new Error("Failed to load photos");
  return r.json();
}

export async function uploadPhotos(files, relatedTo = "") {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  if (relatedTo) form.append("related_to", relatedTo);
  const r = await fetch(`${BASE}/api/photos/upload`, {
    method: "POST",
    body: form,
  });
  if (!r.ok) throw new Error("Upload failed");
  return r.json();
}

export async function deletePhoto(id) {
  const r = await fetch(`${BASE}/api/photos/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Delete failed");
  return r.json();
}

export async function getPins() {
  const r = await fetch(`${BASE}/api/pins`);
  if (!r.ok) throw new Error("Failed to load pins");
  return r.json();
}

export async function createPin(payload) {
  const r = await fetch(`${BASE}/api/pins`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error("Failed to create pin");
  return r.json();
}

export async function deletePin(id) {
  const r = await fetch(`${BASE}/api/pins/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Delete failed");
  return r.json();
}

export async function getDocuments() {
  const r = await fetch(`${BASE}/api/documents`);
  if (!r.ok) throw new Error("Failed to load documents");
  return r.json();
}

export async function getDocument(id) {
  const r = await fetch(`${BASE}/api/documents/${id}`);
  if (!r.ok) throw new Error("Failed to load document");
  return r.json();
}

export async function uploadDocuments(files, meta = {}) {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  if (meta.notes) form.append("notes", meta.notes);
  if (meta.related_to) form.append("related_to", meta.related_to);
  if (meta.source_label) form.append("source_label", meta.source_label);
  const r = await fetch(`${BASE}/api/documents/upload`, {
    method: "POST",
    body: form,
  });
  if (!r.ok) throw new Error("Document upload failed");
  return r.json();
}

export async function deleteDocument(id) {
  const r = await fetch(`${BASE}/api/documents/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Delete failed");
  return r.json();
}

export async function createDocumentPin(documentId, payload) {
  const r = await fetch(`${BASE}/api/documents/${documentId}/pins`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error("Failed to create document pin");
  return r.json();
}

export async function getLinks() {
  const r = await fetch(`${BASE}/api/links`);
  if (!r.ok) throw new Error("Failed to load links");
  return r.json();
}

export async function createLink(payload) {
  const r = await fetch(`${BASE}/api/links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error("Failed to create link");
  return r.json();
}

export async function getFieldObjects() {
  const r = await fetch(`${BASE}/api/objects`);
  if (!r.ok) throw new Error("Failed to load field objects");
  return r.json();
}

export async function createFieldObject(payload) {
  const r = await fetch(`${BASE}/api/objects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error("Failed to create field object");
  return r.json();
}

export async function exportLfi(ids, lang = "en") {
  const r = await fetch(`${BASE}/api/lfi/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, lang }),
  });
  if (!r.ok) throw new Error("Export failed");
  return r.json();
}

export function downloadReportUrl(filename) {
  return `${BASE}/api/reports/download/${encodeURIComponent(filename)}`;
}

export async function getStorageSize() {
  const r = await fetch(`${BASE}/api/storage/size`);
  if (!r.ok) throw new Error("Failed to get storage size");
  return r.json();
}

export async function health() {
  const r = await fetch(`${BASE}/api/health`);
  return r.json();
}

export async function clearAllData() {
  const r = await fetch(`${BASE}/api/dev/clear`, { method: "POST" });
  if (!r.ok) throw new Error("Clear failed");
  return r.json();
}

export async function getTracks() {
  const r = await fetch(`${BASE}/api/tracks`);
  if (!r.ok) throw new Error("Failed to load tracks");
  return r.json();
}

export async function importAar(file) {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${BASE}/api/imports/aar`, { method: "POST", body: form });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || "Import failed");
  return data;
}

export async function deleteTrack(id) {
  const r = await fetch(`${BASE}/api/tracks/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Delete failed");
  return r.json();
}

// For photo thumbs / full: use `${BASE}/photos/${filename}` or thumbs if present
export function photoUrl(filename) {
  return `${BASE}/photos/${encodeURIComponent(filename)}`;
}
export function thumbUrl(thumbPath) {
  if (!thumbPath) return null;
  // thumbPath is absolute on server fs, but we mounted /photos so derive
  const name = thumbPath.split(/[\\/]/).pop();
  return `${BASE}/photos/thumbs/${encodeURIComponent(name)}`;
}


