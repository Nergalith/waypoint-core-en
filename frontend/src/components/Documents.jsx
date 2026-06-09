import React, { useEffect, useMemo, useState } from "react";
import { createDocumentPin, uploadDocuments } from "../api";
import { t } from "../i18n";

export default function Documents({ lang = "en", documents = [], onUploaded, onPinCreated, focusedId }) {
  const tt = (key, vars = {}) => t(key, lang, vars);
  const [notes, setNotes] = useState("");
  const [relatedTo, setRelatedTo] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [fullDoc, setFullDoc] = useState(null);

  async function handleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setStatus(tt("docs.uploading"));
    try {
      const res = await uploadDocuments(Array.from(fileList), {
        notes,
        related_to: relatedTo,
        source_label: sourceLabel,
      });
      setStatus(tt("docs.upload_success", {count: res.uploaded}));
      setNotes("");
      setRelatedTo("");
      setSourceLabel("");
      if (onUploaded) await onUploaded();
    } catch {
      setStatus(tt("docs.upload_error"));
    } finally {
      setUploading(false);
      setTimeout(() => setStatus(""), 4200);
    }
  }

  async function createPin(doc, coord) {
    try {
      await createDocumentPin(doc.id, {
        latitude: coord.latitude,
        longitude: coord.longitude,
        label: tt("docs.pin_label", { name: doc.original_filename }),
      });
      setStatus(tt("docs.pin_created", {lat: coord.latitude, lon: coord.longitude}));
      if (onPinCreated) await onPinCreated();
    } catch {
      setStatus(tt("docs.pin_error"));
    }
  }

  useEffect(() => {
    if (!focusedId?.id) return;
    const element = document.getElementById(`source-document-${focusedId.id}`);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("source-highlight");
    const timer = setTimeout(() => element.classList.remove("source-highlight"), 2800);
    return () => clearTimeout(timer);
  }, [focusedId]);

  return (
    <div className="card">
      <h2>{tt("docs.title")}</h2>
      <p style={{ color: "var(--soft)" }}>{tt("docs.intro")}</p>

      <div className="doc-upload-grid">
        <div>
          <label>{tt("docs.notes")}</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tt("docs.notes_placeholder")} />
        </div>
        <div>
          <label>{tt("docs.related")}</label>
          <input value={relatedTo} onChange={(e) => setRelatedTo(e.target.value)} placeholder={tt("docs.related_placeholder")} />
        </div>
        <div>
          <label>{tt("docs.source")}</label>
          <input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder={tt("docs.source_placeholder")} />
        </div>
      </div>

      <div className="dropzone" title={tt("docs.drop")} onClick={() => document.getElementById("doc-input").click()}>
        <div><strong>{tt("docs.drop")}</strong></div>
        <div style={{ fontSize: 13 }}>{tt("docs.drop_hint")}</div>
        <input
          id="doc-input"
          type="file"
          multiple
          accept=".txt,.csv,.pdf,.docx,image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {uploading && <div className="status">{tt("docs.uploading")}</div>}
      {status && <div className="status">{status}</div>}

      <div className="doc-list">
        {documents.length === 0 && <div className="empty-state">{tt("docs.empty")}</div>}
        {documents.map((doc) => (
          <DocumentCard
            key={doc.id}
            doc={doc}
            tt={tt}
            onView={() => setFullDoc(doc)}
            onCreatePin={(coord) => createPin(doc, coord)}
          />
        ))}
      </div>

      {fullDoc && (
        <div className="modal-backdrop" onClick={() => setFullDoc(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center"}}>
              <h2 style={{margin: 0}}>{fullDoc.original_filename}</h2>
              <button className="small-action" title={tt("reports.close")} onClick={() => setFullDoc(null)}>{tt("reports.close")}</button>
            </div>
            <pre className="text-preview-full">{fullDoc.extracted_text || fullDoc.extraction_detail || tt("docs.no_text")}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentCard({ doc, tt, onView, onCreatePin }) {
  const clues = doc.clues || {};
  const coordinates = clues.coordinates || [];
  const keywords = clues.keywords || [];
  const dates = clues.dates || [];
  const places = clues.possible_places || [];
  const entities = clues.possible_entities || [];

  const keywordText = useMemo(() => {
    return keywords.map((k) => `${keywordLabel(k.group, tt)}: ${(k.matches || []).join(", ")}`).join(" | ");
  }, [keywords, tt]);

  return (
    <div className="doc-card" id={`source-document-${doc.id}`}>
      <div className="doc-card-head">
        <div>
          <strong>{doc.original_filename}</strong>
          <div className="doc-meta">{(doc.file_type || tt("docs.file_type_fallback")).toUpperCase()} | {doc.uploaded_at}</div>
        </div>
        <span className={`extract-status status-${doc.extraction_status}`}>{tt(`docs.status.${doc.extraction_status}`)}</span>
      </div>

      {doc.extraction_status === 'error' && doc.extraction_detail && <div className="tooltip">{doc.extraction_detail}</div>}
      {doc.notes && <div className="doc-note">{tt("docs.notes")}: {doc.notes}</div>}
      {doc.related_to && <div className="doc-note">{tt("common.linked", {note: doc.related_to})}</div>}

      <div className="doc-preview">{doc.text_preview || tt("docs.no_text")}</div>

      <div className="clue-grid">
        {dates.length > 0 && <ClueBlock label={tt("docs.clue_dates")} value={dates.join(", ")} />}
        {coordinates.length > 0 && <ClueBlock label={tt("docs.clue_coords")} value={coordinates.map(c => c.text).join(" | ")} />}
        {places.length > 0 && <ClueBlock label={tt("docs.clue_places")} value={places.join(", ")} />}
        {entities.length > 0 && <ClueBlock label={tt("docs.clue_entities")} value={entities.join(", ")} />}
        {keywordText && <ClueBlock label={tt("docs.clue_keywords")} value={keywordText} />}
      </div>

      {coordinates.length > 0 && (
        <div className="coord-actions">
          {coordinates.slice(0, 3).map((coord, idx) => (
            <button key={`${coord.latitude}-${coord.longitude}-${idx}`} className="small-action" title={tt("docs.create_pin", {lat: coord.latitude, lon: coord.longitude})} onClick={() => onCreatePin(coord)}>
              {tt("docs.create_pin", {lat: coord.latitude, lon: coord.longitude})}
            </button>
          ))}
        </div>
      )}

      <button className="small-action" title={tt("docs.view_full")} onClick={onView}>{tt("docs.view_full")}</button>
    </div>
  );
}

function ClueBlock({ label, value }) {
  return (
    <div className="clue-block">
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}

function keywordLabel(group, tt) {
  const translated = tt(`docs.keyword.${group}`);
  return translated.startsWith("docs.keyword.") ? String(group || "") : translated;
}

