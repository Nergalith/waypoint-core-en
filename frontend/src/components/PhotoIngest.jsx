import React, { useEffect, useState } from "react";
import { deletePhoto, uploadPhotos, photoUrl, thumbUrl, createLink } from "../api";
import { t } from "../i18n";
import { triggerGlobalRefresh } from "../utils/refreshBus";

export default function PhotoIngest({ lang = "en", onUploaded, photos, recentLfi = [], links = [], currentReportContext, focusedId }) {
  const tt = (key, vars = {}) => t(key, lang, vars);

  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [relatedToNote, setRelatedToNote] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  async function handleDelete(photoId) {
    if (!window.confirm(tt("photo.delete_confirm"))) return;
    setDeletingId(photoId);
    try {
      await deletePhoto(photoId);
      setStatus(tt("photo.delete_success"));
      triggerGlobalRefresh();
      if (onUploaded) onUploaded();
    } catch {
      setStatus(tt("photo.delete_error"));
    } finally {
      setDeletingId(null);
      setTimeout(() => setStatus(""), 3800);
    }
  }
  const [linkStatus, setLinkStatus] = useState({}); // per photo id status
  const [viewAll, setViewAll] = useState(false);

  // Filter to photos linked to the current report context. viewAll overrides; null context with no viewAll shows empty.
  const displayedPhotos = React.useMemo(() => {
    const list = photos || [];
    if (viewAll) return list;
    if (currentReportContext == null) return [];
    const ctx = String(currentReportContext);
    const ctxReport = (recentLfi || []).find(r => String(r.id) === ctx);
    const ctxNum = ctxReport?.report_number || null;
    return list.filter(p => {
      const hasLink = (links || []).some(lk =>
        (lk.source_type === "photo" && String(lk.source_id) === String(p.id) && lk.target_type === "field_report" && String(lk.target_id) === ctx) ||
        (lk.target_type === "photo" && String(lk.target_id) === String(p.id) && lk.source_type === "field_report" && String(lk.source_id) === ctx)
      );
      if (hasLink) return true;
      if (p.related_to) {
        if (p.related_to.includes(ctx) || p.related_to.includes(`RPT-${ctx}`)) return true;
        if (ctxNum && p.related_to.includes(ctxNum)) return true;
      }
      return false;
    });
  }, [photos, links, currentReportContext, viewAll, recentLfi]);

  async function addPhotoToReport(photoId, reportId) {
    if (!reportId) return;
    const report = (recentLfi || []).find(r => String(r.id) === String(reportId));
    const reportLabel = (report && report.report_number) ? report.report_number : `RPT-${reportId}`;
    setLinkStatus(s => ({ ...s, [photoId]: tt("photo.linking") }));
    try {
      await createLink({
        source_type: "photo",
        source_id: String(photoId),
        source_label: `Photo ${photoId}`,
        relationship_type: "associated_with",
        target_type: "field_report",
        target_id: String(reportId),
        target_label: reportLabel,
        notes: tt("photo.link_note"),
      });
      setLinkStatus(s => ({ ...s, [photoId]: tt("photo.linked_status") }));
      setTimeout(() => setLinkStatus(s => { const n={...s}; delete n[photoId]; return n; }), 2500);
      triggerGlobalRefresh();
      if (onUploaded) onUploaded();
    } catch {
      setLinkStatus(s => ({ ...s, [photoId]: tt("photo.link_error") }));
    }
  }

  async function handleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setStatus(tt("photo.extracting"));

    try {
      const res = await uploadPhotos(Array.from(fileList), relatedToNote);
      setStatus(tt("photo.success", {count: res.uploaded}));
      setRelatedToNote(""); // clear after use
      triggerGlobalRefresh();
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
        <div> <strong>{tt("photo.drop")}</strong></div>
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "12px 0 6px" }}>
            <strong>{tt("photo.ingested_title", {count: photos.length})}</strong>
            <button
              type="button"
              className="small-action"
              onClick={() => setViewAll(v => !v)}
              style={{ fontSize: 11 }}
            >
              {viewAll ? tt("photo.filter_only_current") : tt("photo.view_all")}
            </button>
          </div>
          <div className="photo-grid">
            {displayedPhotos.map((p, idx) => (
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
                  <div style={{marginTop: 4}}>
                    <select
                      style={{fontSize:11, maxWidth: "70%"}}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val) {
                          addPhotoToReport(p.id, val);
                          e.target.value = "";
                        }
                      }}
                      defaultValue=""
                    >
                      <option value="">{tt("photo.add_to_report")}</option>
                      {(recentLfi || []).slice(0, 8).map(r => (
                        <option key={r.id} value={r.id}>{r.report_number || `RPT-${r.id}`} { (r.what_happened || r.who_involved || "").slice(0,28) }</option>
                      ))}
                    </select>
                    {linkStatus[p.id] && <span style={{fontSize:10, marginLeft:4}}>{linkStatus[p.id]}</span>}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <button
                      className="small-action"
                      onClick={() => handleDelete(p.id)}
                      disabled={deletingId === p.id}
                      style={{ fontSize: 11, background: "rgba(239,68,68,0.10)", borderColor: "rgba(239,68,68,0.5)", color: "#ef4444" }}
                    >
                      {deletingId === p.id ? tt("common.loading") : tt("photo.delete_btn")}
                    </button>
                  </div>
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

