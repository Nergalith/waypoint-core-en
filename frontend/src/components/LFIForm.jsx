import React, { useEffect, useMemo, useState } from "react";
import { createLfi, deleteLfi, downloadReportUrl, exportLfi, finalizeLfi, reopenLfi, updateLfi } from "../api";
import { t, translateReportType } from "../i18n";
import { PIN_CATEGORIES, STATUS_COLORS } from "../pinConstants";

const BLANK_FORM = {
  report_type: "Observation",
  who_involved: "",
  what_happened: "",
  where_happened: "",
  when_happened: "",
  notes: "",
  related_to: "",
  source_reliability: "F",
  latitude: "",
  longitude: "",
  pin_category: "general",
  pin_color: "#eab308",
  report_number: "",
};

export default function LFIForm({
  lang = "en",
  onSaved,
  recentLfi,
  mapCoords,
  onMapCoordsUsed,
  focusedId,
  form,
  setForm,
  selectedRel,
  setSelectedRel,
  editingId,
  setEditingId,
  currentReportContext,
  onStartNewReport,
  onReportContextChange,
}) {
  const tt = (key, vars = {}) => t(key, lang, vars);

  const REPORT_TYPES = useMemo(() => [
    ["Observation", tt("type.Observation")],
    ["Patrol", tt("type.Patrol")],
    ["Rumor/Witness", tt("type.Rumor")],
    ["Checkpoint", tt("type.Checkpoint")],
    ["Contact Report", tt("type.Contact")],
  ], [lang]);

  const RELIABILITIES = useMemo(() => [
    { code: "A", label: tt("rel.A_label"), color: "#16a34a", tip: tt("rel.A_tip") },
    { code: "B", label: tt("rel.B_label"), color: "#84cc16", tip: tt("rel.B_tip") },
    { code: "C", label: tt("rel.C_label"), color: "#eab308", tip: tt("rel.C_tip") },
    { code: "D", label: tt("rel.D_label"), color: "#f97316", tip: tt("rel.D_tip") },
    { code: "E", label: tt("rel.E_label"), color: "#ef4444", tip: tt("rel.E_tip") },
    { code: "F", label: tt("rel.F_label"), color: "#6b7280", tip: tt("rel.F_tip") },
  ], [lang]);

  // Dynamic form fields per report type (Issue 2). Values still map to existing DB columns.
  const FIELD_DEFS = useMemo(() => {
    const common = {
      when: { key: "when_happened", label: tt("lfi.when_label"), placeholder: tt("lfi.when_placeholder"), tip: "" },
      notes: { key: "notes", label: tt("lfi.notes_label"), placeholder: tt("lfi.notes_placeholder"), tip: "", textarea: true, wide: true },
      reliability: true,
    };
    const defs = {
      Observation: [
        { key: "who_involved", label: "Who was involved", placeholder: tt("lfi.who_placeholder"), tip: "Simple description." },
        { key: "what_happened", label: "What happened", placeholder: tt("lfi.what_placeholder"), tip: "Facts only.", textarea: true, wide: true },
        { key: "where_happened", label: "Where", placeholder: tt("lfi.where_placeholder"), tip: "" },
        common.when,
        common.notes,
      ],
      Patrol: [
        { key: "who_involved", label: "Size", placeholder: "How many / what size (e.g. 4 men, 2 vehicles)", tip: "SALUTE: Size" },
        { key: "what_happened", label: "Activity", placeholder: "What they were doing (moving, setting up...)", tip: "SALUTE: Activity", textarea: true, wide: true },
        { key: "where_happened", label: "Location", placeholder: "Where observed", tip: "SALUTE: Location" },
        { key: "related_to", label: "Unit / Uniform", placeholder: "Uniform, unit markings, ID if known", tip: "SALUTE: Unit/Uniform" },
        common.when,
        { key: "notes", label: "Equipment + Notes", placeholder: "Weapons, gear, vehicles, other details", tip: "SALUTE: Equipment + any notes", textarea: true },
      ],
      "Rumor/Witness": [
        { key: "who_involved", label: "Who told you", placeholder: "Source of the information (witness name or description)", tip: "The 5 Ws" },
        { key: "what_happened", label: "What did they say", placeholder: "Summary of what the person reported", tip: "", textarea: true, wide: true },
        { key: "where_happened", label: "Where did it happen", placeholder: "Place described by the source", tip: "" },
        common.when,
        { key: "notes", label: "Why do they think this", placeholder: "Reason or basis for the information", tip: "5th W: Why", textarea: true, wide: true },
      ],
      Checkpoint: [
        { key: "who_involved", label: "Vehicle description", placeholder: "Type, color, plate, markings", tip: "" },
        { key: "what_happened", label: "Direction of travel, Number of occupants", placeholder: "Direction (northbound etc.) and number of people", tip: "", textarea: true, wide: true },
        { key: "where_happened", label: "Location", placeholder: "Where the checkpoint or sighting was", tip: "" },
        { key: "related_to", label: "Weapons visible", placeholder: "Any weapons seen? Describe briefly", tip: "" },
        common.when,
        common.notes,
      ],
      "Contact Report": [
        { key: "who_involved", label: "Who made contact", placeholder: "Your unit / patrol or the element that had contact", tip: "" },
        { key: "what_happened", label: "What happened (Friendly/Hostile/Unknown)", placeholder: "Sequence of events and nature of contact", tip: "", textarea: true, wide: true },
        { key: "related_to", label: "Casualties", placeholder: "Casualties, damage, result", tip: "" },
        { key: "where_happened", label: "Location", placeholder: "Where contact occurred", tip: "" },
        common.when,
        common.notes,
      ],
    };
    return defs[form.report_type] || defs.Observation;
  }, [form.report_type, lang]);

  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [lockingId, setLockingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [generating, setGenerating] = useState(false);
  const [downloadFile, setDownloadFile] = useState(null);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function pickReliability(code) {
    setSelectedRel(code);
    update("source_reliability", code);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(BLANK_FORM);
    setSelectedRel("F");
    if (onReportContextChange) onReportContextChange(null);
  }

  function handleEditDraft(l) {
    setForm({
      report_type: l.report_type || "Observation",
      who_involved: l.who_involved || "",
      what_happened: l.what_happened || "",
      where_happened: l.where_happened || "",
      when_happened: l.when_happened || "",
      notes: l.notes || "",
      related_to: l.related_to || "",
      source_reliability: l.source_reliability || "F",
      latitude: l.latitude != null ? String(l.latitude) : "",
      longitude: l.longitude != null ? String(l.longitude) : "",
      pin_category: l.pin_category || "general",
      pin_color: l.pin_color || "#eab308",
      report_number: l.report_number || "",
    });
    setSelectedRel(l.source_reliability || "F");
    setEditingId(l.id);
    if (onReportContextChange) onReportContextChange(l.id);
    setStatus(tt("lfi.editing_banner", { id: l.id }));
    document.getElementById("lfi-form-top")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    if (!mapCoords) return;
    setForm((f) => ({
      ...f,
      latitude: String(mapCoords.latitude),
      longitude: String(mapCoords.longitude),
    }));
    setStatus(tt("lfi.map_coords_used", { lat: mapCoords.latitude, lon: mapCoords.longitude }));
    if (onMapCoordsUsed) onMapCoordsUsed();
  }, [mapCoords]);

  useEffect(() => {
    if (!focusedId?.id) return;
    const element = document.getElementById(`source-lfi-${focusedId.id}`);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("source-highlight");
    const timer = setTimeout(() => element.classList.remove("source-highlight"), 2800);
    return () => clearTimeout(timer);
  }, [focusedId]);

  async function handleFinalize(id) {
    if (lockingId) return;
    setLockingId(id);
    try {
      await finalizeLfi(id, lang);
      if (onSaved) onSaved();
    } catch {
      setStatus(tt("lfi.finalize_error"));
      setTimeout(() => setStatus(""), 4200);
    } finally {
      setLockingId(null);
    }
  }

  async function handleReopen(id) {
    if (lockingId) return;
    setLockingId(id);
    try {
      const report = await reopenLfi(id);
      setForm({
        report_type: report.report_type || "Observation",
        who_involved: report.who_involved || "",
        what_happened: report.what_happened || "",
        where_happened: report.where_happened || "",
        when_happened: report.when_happened || "",
        notes: report.notes || "",
        related_to: report.related_to || "",
        source_reliability: report.source_reliability || "F",
        latitude: report.latitude != null ? String(report.latitude) : "",
        longitude: report.longitude != null ? String(report.longitude) : "",
        pin_category: report.pin_category || "general",
        pin_color: report.pin_color || "#eab308",
        report_number: report.report_number || "",
      });
      setSelectedRel(report.source_reliability || "F");
      setEditingId(report.id);
      if (onReportContextChange) onReportContextChange(report.id);
      setStatus(tt("lfi.unlocked_to_edit", { id: report.id }));
      document.getElementById("lfi-form-top")?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (onSaved) onSaved();
    } catch {
      setStatus(tt("lfi.unlock_error"));
      setTimeout(() => setStatus(""), 4200);
    } finally {
      setLockingId(null);
    }
  }

  async function handleDelete(id) {
    if (deletingId) return;
    const report = (recentLfi || []).find(r => r.id === id) || {};
    const rnum = report.report_number || `RPT-${id}`;
    if (!window.confirm(tt("lfi.delete_confirm_initial", { report: rnum }))) return;

    // Safe delete per issue 6: extra warning if no PDF exported yet
    const hasPdf = !!report.pdf_path;
    const isFinal = report.status === "finalized";
    if (!hasPdf && !isFinal) {
      if (!window.confirm(tt("lfi.delete_confirm_unexported"))) return;
    } else {
      if (!window.confirm(tt("lfi.delete_confirm_final", { report: rnum }))) return;
    }

    setDeletingId(id);
    try {
      await deleteLfi(id);
      if (editingId === id) cancelEdit();
      if (onSaved) onSaved();
    } catch {
      setStatus(tt("lfi.delete_error"));
      setTimeout(() => setStatus(""), 4200);
    } finally {
      setDeletingId(null);
    }
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function handleExport() {
    if (selectedIds.size === 0 || generating) return;
    setGenerating(true);
    setDownloadFile(null);
    try {
      const result = await exportLfi(Array.from(selectedIds), lang);
      setStatus(tt("lfi.report_generated", { filename: result.filename }));
      setDownloadFile(result.filename);
      exitSelectMode();
      setTimeout(() => { setStatus(""); setDownloadFile(null); }, 30000);
    } catch {
      setStatus(tt("lfi.export_error"));
      setTimeout(() => setStatus(""), 4200);
    } finally {
      setGenerating(false);
    }
  }

  function parseCoordinatePair() {
    const hasLat = String(form.latitude).trim() !== "";
    const hasLon = String(form.longitude).trim() !== "";
    if (!hasLat && !hasLon) return { latitude: null, longitude: null };
    if (hasLat !== hasLon) throw new Error(tt("lfi.coord_pair_error"));

    const latitude = Number(form.latitude);
    const longitude = Number(form.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error(tt("lfi.coord_number_error"));
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new Error(tt("lfi.coord_range_error"));
    }
    return {
      latitude: Number(latitude.toFixed(6)),
      longitude: Number(longitude.toFixed(6)),
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setStatus("");

    let coords;
    try {
      coords = parseCoordinatePair();
    } catch (err) {
      setStatus(err.message);
      setSaving(false);
      return;
    }

    try {
      if (editingId) {
        const saved = await updateLfi(editingId, { ...form, ...coords });
        setStatus(tt("lfi.update_success"));
        setEditingId(null);
        setForm(BLANK_FORM);
        setSelectedRel("F");
        if (onReportContextChange && saved?.id) onReportContextChange(saved.id);
      } else {
        const saved = await createLfi({ ...form, ...coords });
        setStatus(tt("lfi.success"));
        setForm((prev) => ({ ...BLANK_FORM, report_type: prev.report_type }));
        setSelectedRel("F");
        if (onReportContextChange && saved?.id) onReportContextChange(saved.id);
      }
      if (onSaved) onSaved();
    } catch {
      setStatus(editingId ? tt("lfi.update_error") : tt("lfi.error"));
    } finally {
      setSaving(false);
      setTimeout(() => setStatus(""), 4200);
    }
  }

  const currentRel = RELIABILITIES.find((r) => r.code === selectedRel) || RELIABILITIES[5];
  const visibleRecentLfi = useMemo(() => {
    const firstReports = (recentLfi || []).slice(0, 4);
    if (!focusedId?.id || firstReports.some((item) => String(item.id) === String(focusedId.id))) {
      return firstReports;
    }
    const focusedReport = (recentLfi || []).find((item) => String(item.id) === String(focusedId.id));
    return focusedReport ? [focusedReport, ...firstReports.slice(0, 3)] : firstReports;
  }, [recentLfi, focusedId]);

  return (
    <div className="card">
      <h2 id="lfi-form-top">{tt("lfi.title")}</h2>
      <p style={{ color: "var(--soft)", marginBottom: 12 }}>
        {tt("lfi.intro")}
      </p>

      <div style={{ marginBottom: 10 }}>
        <button
          type="button"
          className="small-action new-report-action"
          onClick={() => {
            if (onStartNewReport) onStartNewReport();
            else {
              setForm(BLANK_FORM);
              setSelectedRel("F");
              setEditingId(null);
              if (onReportContextChange) onReportContextChange(null);
            }
          }}
          style={{ fontSize: 12, background: "rgba(16,185,129,0.12)", borderColor: "#10b981" }}
        >
          + New Report
        </button>
      </div>

      {editingId && (
        <div style={{
          background: "rgba(234,179,8,0.12)", border: "1px solid rgba(234,179,8,0.4)",
          borderRadius: 4, padding: "7px 12px", marginBottom: 12,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: 13 }}>{tt("lfi.editing_banner", { id: editingId })}</span>
          <button type="button" className="small-action" onClick={cancelEdit} style={{ fontSize: 11 }}>
            {tt("lfi.cancel_edit")}
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="lfi-form-grid">
        <div className="lfi-field"><label>{tt("lfi.type_label")}</label>
        <select
          value={form.report_type}
          onChange={(e) => {
            const newType = e.target.value;
            setForm((f) => ({
              ...f,
              report_type: newType,
              who_involved: "",
              what_happened: "",
              where_happened: "",
              when_happened: "",
              notes: "",
              related_to: "",
            }));
          }}
        >
          {REPORT_TYPES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select></div>

        {/* Dynamic fields based on report type (plain language, per brief) */}
        {FIELD_DEFS.map((f, idx) => (
          <div key={idx} className={`lfi-field ${f.wide ? "wide" : ""}`}>
            <label>{f.label}</label>
            {f.textarea ? (
              <textarea
                placeholder={f.placeholder}
                value={form[f.key] || ""}
                onChange={(e) => update(f.key, e.target.value)}
              />
            ) : (
              <input
                type="text"
                placeholder={f.placeholder}
                value={form[f.key] || ""}
                onChange={(e) => update(f.key, e.target.value)}
              />
            )}
            {f.tip && <div className="tooltip">{f.tip}</div>}
          </div>
        ))}

        {/* Always show lat/lon for map pin (if provided). Location text goes in Where field above. */}
        <div className="lfi-field coord-pair wide">
          <div>
            <label>{tt("lfi.lat_label")}</label>
            <input
              type="text"
              placeholder={tt("lfi.lat_placeholder")}
              value={form.latitude}
              onChange={(e) => update("latitude", e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div>
            <label>{tt("lfi.lon_label")}</label>
            <input
              type="text"
              placeholder={tt("lfi.lon_placeholder")}
              value={form.longitude}
              onChange={(e) => update("longitude", e.target.value)}
              inputMode="decimal"
            />
          </div>
        </div>
        <div className="tooltip">{tt("lfi.geo_tip")}</div>

        <div className="lfi-field wide"><label>{tt("lfi.reliability_label")}</label>
        <div className="reliability-grid">
          {RELIABILITIES.map((r) => (
            <button
              type="button"
              key={r.code}
              className={`rel-btn ${selectedRel === r.code ? "selected" : ""}`}
              style={{ background: r.color }}
              onClick={() => pickReliability(r.code)}
              title={r.tip}
            >
              {r.code}
            </button>
          ))}
        </div>
        <div className="tooltip" style={{ marginTop: 4 }}>
          {tt("lfi.reliability_tip", { label: currentRel.label, tip: currentRel.tip })}
        </div></div>

        {/* NEW: Pin category and status color for auto map pin pipeline */}
        <div className="lfi-field"><label>{tt("lfi.pin_category_label")}</label>
        <select
          value={form.pin_category || "general"}
          onChange={(e) => update("pin_category", e.target.value)}
        >
          {Object.entries(PIN_CATEGORIES).map(([key, cat]) => (
            <option key={key} value={key}>{cat.symbol} {tt(`pin.cat.${key}`) || cat.labelEn || key}</option>
          ))}
        </select></div>

        <div className="lfi-field"><label>{tt("lfi.pin_status_label")}</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(STATUS_COLORS).map(([key, c]) => {
            const active = (form.pin_color || "#eab308") === c.hex;
            return (
              <button
                type="button"
                key={key}
                onClick={() => update("pin_color", c.hex)}
                title={tt(`pin.status.${key}`) || c.labelEn}
                style={{
                  width: 28, height: 28, borderRadius: 4,
                  background: c.hex,
                  border: active ? "2px solid #fff" : "1px solid rgba(255,255,255,0.3)",
                  cursor: "pointer",
                  boxShadow: active ? "0 0 0 2px #eab308" : "none",
                }}
              />
            );
          })}
        </div>
        <div className="tooltip" style={{ marginTop: 2, fontSize: 11 }}>
          {tt("map.colors")}
        </div></div>

        <button type="submit" className="big-button wide" disabled={saving}>
          {saving ? tt("lfi.submit_saving") : editingId ? tt("lfi.update") : tt("lfi.submit")}
        </button>
      </form>

      {status && <div className="status">{status}</div>}
      {downloadFile && (
        <div style={{ marginTop: 6 }}>
          <a
            href={downloadReportUrl(downloadFile)}
            download={downloadFile}
            style={{ color: "var(--accent)", fontSize: 13, textDecoration: "underline" }}
          >
            ⬇ {tt("lfi.download_btn")}
          </a>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <strong>{tt("lfi.recent_title")}</strong>
          <div style={{ display: "flex", gap: 6 }}>
            {selectMode ? (
              <>
                <button
                  className="small-action"
                  onClick={handleExport}
                  disabled={selectedIds.size === 0 || generating}
                  style={{ fontSize: 11, background: "rgba(234,179,8,0.15)", borderColor: "#eab308" }}
                >
                  {generating ? "..." : tt("lfi.generate_report_btn", { count: selectedIds.size })}
                </button>
                <button className="small-action" onClick={exitSelectMode} disabled={generating} style={{ fontSize: 11 }}>
                  {tt("lfi.select_cancel")}
                </button>
              </>
            ) : (
              (recentLfi || []).length > 0 && (
                <button className="small-action" onClick={() => setSelectMode(true)} style={{ fontSize: 11 }}>
                  {tt("lfi.select_mode_btn")}
                </button>
              )
            )}
          </div>
        </div>

        {(selectMode ? recentLfi : visibleRecentLfi).length === 0 && (
          <div className="empty-state">{tt("lfi.empty")}</div>
        )}

        {(selectMode ? (recentLfi || []) : visibleRecentLfi).map((l, i) => {
          const isFinalized = l.status === "finalized";
          const isBusy = lockingId === l.id;
          const isDeleting = deletingId === l.id;
          const isChecked = selectedIds.has(l.id);
          const isEditing = editingId === l.id;
          return (
            <div
              key={l.id || i}
              id={`source-lfi-${l.id}`}
              className="list-item report-row"
              style={{
                fontSize: 13,
                opacity: isFinalized ? 0.82 : 1,
                outline: selectMode && isChecked
                  ? "1px solid #eab308"
                  : isEditing
                    ? "1px solid rgba(234,179,8,0.7)"
                    : "none",
                cursor: selectMode ? "pointer" : "default",
              }}
              onClick={selectMode ? () => toggleSelect(l.id) : undefined}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6, flexWrap: "wrap" }}>
                {selectMode && (
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleSelect(l.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginTop: 2, flexShrink: 0 }}
                  />
                )}
                <span className="pill" style={{ background: reliability_color(l.source_reliability), flexShrink: 0 }}>
                  {l.source_reliability}
                </span>
                {isFinalized && (
                  <span style={{
                    background: "rgba(22,163,74,0.15)", color: "#4ade80",
                    border: "1px solid rgba(22,163,74,0.4)", fontSize: 10,
                    padding: "1px 6px", borderRadius: 3, fontWeight: 700,
                    flexShrink: 0, alignSelf: "center",
                  }}>
                    LOCKED {tt("lfi.status.finalized")}
                  </span>
                )}
                <span style={{ flex: 1 }}>
                  <strong>{l.report_number || `RPT-${l.id}`}</strong> - {translateReportType(l.report_type, tt)} - {l.what_happened?.slice(0, 70) || l.who_involved?.slice(0, 50) || tt("lfi.no_detail")}
                  {l.latitude && " GPS"}
                  {l.related_to && <span style={{color: 'var(--accent)'}}> | {tt("common.linked", {note: l.related_to.slice(0,30)})}</span>}
                </span>
              </div>
              {isFinalized && l.finalized_at && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, marginLeft: 2 }}>
                  {tt("lfi.finalized_at", { date: l.finalized_at.replace("T", " ").replace("Z", "") })}
                </div>
              )}
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1, marginLeft: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {l.created_at && <span>C: {l.created_at.replace("T"," ").slice(0,16)}</span>}
                {l.last_edited_at && <span>E: {l.last_edited_at.replace("T"," ").slice(0,16)}</span>}
                {l.reopened_at && <span>R: {l.reopened_at.replace("T"," ").slice(0,16)}</span>}
              </div>
              {!selectMode && (
                <div style={{ marginTop: 5, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {!isFinalized && (
                    <button
                      className="small-action"
                      onClick={() => handleEditDraft(l)}
                      style={{ fontSize: 11 }}
                    >
                      {tt("lfi.edit_btn") || "Edit"}
                    </button>
                  )}
                  {isFinalized ? (
                    <button
                      className="small-action"
                      onClick={() => handleReopen(l.id)}
                      disabled={isBusy}
                      style={{ fontSize: 11 }}
                    >
                      {isBusy ? "..." : tt("lfi.unlock_btn")}
                    </button>
                  ) : (
                    <button
                      className="small-action"
                      onClick={() => handleFinalize(l.id)}
                      disabled={isBusy}
                      style={{ fontSize: 11, background: "rgba(234,179,8,0.12)", borderColor: "#eab308" }}
                    >
                      {isBusy ? "..." : tt("lfi.finalize_btn")}
                    </button>
                  )}
                  <button
                    className="small-action"
                    onClick={() => handleDelete(l.id)}
                    disabled={isDeleting || isBusy}
                    style={{ fontSize: 11, background: "rgba(239,68,68,0.10)", borderColor: "rgba(239,68,68,0.5)", color: "#ef4444" }}
                  >
                    {isDeleting ? "..." : tt("lfi.delete_btn")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function reliability_color(code) {
  const m = { A: "#16a34a", B: "#84cc16", C: "#eab308", D: "#f97316", E: "#ef4444", F: "#6b7280" };
  return m[(code || "F").toUpperCase()] || "#6b7280";
}

