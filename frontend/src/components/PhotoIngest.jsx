import React, { useEffect, useState } from "react";
import { uploadPhotos, photoUrl, thumbUrl } from "../api";
import { t } from "../i18n";

export default function PhotoIngest({ lang = "fr", onUploaded, photos, focusedId }) {
  const tt = (key, vars = {}) => t(key, lang, vars);

  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [relatedToNote, setRelatedToNote] = useState("");

  async function handleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setStatus(tt("photo.extracting"));

    try {
      const res = await uploadPhotos(Array.from(fileList), relatedToNote);
      setStatus(tt("photo.success", {count: res.uploaded}));
      setRelatedToNote(""); // clear after use
      if (onUploaded) onUploaded();
    } catch (e) {
      setStatus(tt("photo.upload_error"));
    } finally {
      setUploading(false);
      setTimeout(() => setStatus(""), 3800);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  function onSelect(e) {
    handleFiles(e.target.files);
    e.target.value = ""; // reset
  }

  useEffect(() => {
    if (!focusedId?.id) return;
    const element = document.getElementById(`source-photo-${focusedId.id}`);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("source-highlight");
    const timer = setTimeout(() => element.classList.remove("source-highlight"), 2800);
    return () => clearTimeout(timer);
  }, [focusedId]);

  return (
    <div className="card">
      <h2>{tt("photo.title")}</h2>
      <p style={{ color: "var(--soft)" }}>
        {tt("photo.intro")}
      </p>

      <label style={{fontSize: '13px', fontWeight: 600}}>{tt("photo.related_label")}</label>
      <input
        type="text"
        placeholder={tt("photo.related_placeholder")}
        value={relatedToNote}
        onChange={(e) => setRelatedToNote(e.target.value)}
        style={{marginBottom: '8px'}}
      />
      <div className="tooltip" style={{marginBottom: '8px'}}>{tt("photo.related_tip")}</div>

      <div
        className={`dropzone ${dragOver ? "dragover" : ""}`}
        title={tt("photo.drop")}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => document.getElementById("photo-input").click()}
      >
        <div>📥 <strong>{tt("photo.drop")}</strong></div>
        <div style={{ fontSize: 13, marginTop: 4 }}>{tt("photo.drop_or")}</div>
        <input
          id="photo-input"
          type="file"
          multiple
          accept="image/*"
          style={{ display: "none" }}
          onChange={onSelect}
        />
      </div>

      {uploading && <div style={{ margin: "8px 0", color: "var(--accent)" }}>{tt("photo.extracting")}</div>}
      {status && <div className="status">{status}</div>}
      {(!photos || photos.length === 0) && <div className="empty-state">{tt("photo.empty")}</div>}

      {photos && photos.length > 0 && (
        <div>
          <strong style={{ display: "block", margin: "12px 0 6px" }}>{tt("photo.ingested_title", {count: photos.length})}</strong>
          <div className="photo-grid">
            {photos.map((p, idx) => (
              <div key={p.id || idx} id={`source-photo-${p.id}`} className="photo-card">
                {p.thumb_path ? (
                  <img src={thumbUrl(p.thumb_path) || photoUrl(p.stored_path?.split(/[\\/]/).pop())} alt={p.original_filename} />
                ) : (
                  <div style={{ height: 110, background: "var(--bg-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--muted)" }}>
                    {p.original_filename}
                  </div>
                )}
                <div className="photo-meta">
                  <div><strong>{p.original_filename}</strong></div>
                  <div>{p.datetime_original || tt("photo.unknown_date")}</div>
                  {p.has_gps || p.latitude ? (
                    <div style={{ color: "var(--accent)", fontWeight: 600 }}>{tt("common.gps", {lat: Number(p.latitude).toFixed(4), lon: Number(p.longitude).toFixed(4)})}</div>
                  ) : (
                    <div style={{ color: "var(--muted)" }}>{tt("common.no_gps")}</div>
                  )}
                  <div style={{ fontSize: 10, color: "var(--muted)" }}>{p.camera_info || ""}</div>
                  {p.related_to && <div style={{fontSize: '10px', color: 'var(--accent)', marginTop: '2px'}}>{tt("common.linked", {note: p.related_to.slice(0,40)})}</div>}
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, marginTop: 8, color: "var(--soft)" }}>
            {tt("photo.gps_hint")}
          </div>
        </div>
      )}
    </div>
  );
}
