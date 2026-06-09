import React, { useEffect, useMemo, useState } from "react";
import { createLfi, deleteLfi, exportLfi, finalizeLfi, reopenLfi, updateLfi } from "../api";
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
}) {
  const tt = (key, vars = {}) => t(key, lang, vars);

  const REPORT_TYPES = useMemo(() => [
    ["Observation", tt("type.Observation")],
    ["Patrol", tt("type.Patrol")],
    ["Witness", tt("type.Witness")],
    ["Rumor", tt("type.Rumor")],
    ["Other", tt("type.Other")],
  ], [lang]);

  const RELIABILITIES = useMemo(() => [
    { code: "A", label: tt("rel.A_label"), color: "#16a34a", tip: tt("rel.A_tip") },
    { code: "B", label: tt("rel.B_label"), color: "#84cc16", tip: tt("rel.B_tip") },
    { code: "C", label: tt("rel.C_label"), color: "#eab308", tip: tt("rel.C_tip") },
    { code: "D", label: tt("rel.D_label"), color: "#f97316", tip: tt("rel.D_tip") },
    { code: "E", label: tt("rel.E_label"), color: "#ef4444", tip: tt("rel.E_tip") },
    { code: "F", label: tt("rel.F_label"), color: "#6b7280", tip: tt("rel.F_tip") },
  ], [lang]);

  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [lockingId, setLockingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [generating, setGenerating] = useState(false);

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
    });
    setSelectedRel(l.source_reliability || "F");
    setEditingId(l.id);
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
      });
      setSelectedRel(report.source_reliability || "F");
      setEditingId(report.id);
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
    if (!window.confirm(tt("lfi.confirm_delete"))) return;
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
    try {
      const result = await exportLfi(Array.from(selectedIds), lang);
      setStatus(tt("lfi.report_generated", { filename: result.filename }));
      exitSelectMode();
      setTimeout(() => setStatus(""), 7000);
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
        await updateLfi(editingId, { ...form, ...coords });
        setStatus(tt("lfi.update_success"));
        setEditingId(null);
        setForm(BLANK_FORM);
        setSelectedRel("F");
      } else {
        await createLfi({ ...form, ...coords });
        setStatus(tt("lfi.success"));
        setForm((prev) => ({ ...BLANK_FORM, report_type: prev.report_type }));
        setSelectedRel("F");
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

      <form onSubmit={handleSubmit}>
        <label>{tt("lfi.type_label")}</label>
        <select
          value={form.report_type}
          onChange={(e) => update("report_type", e.target.value)}
        >
          {REPORT_TYPES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <label>{tt("lfi.who_label")}</label>
        <input
          type="text"
          placeholder={tt("lfi.who_placeholder")}
          value={form.who_involved}
          onChange={(e) => update("who_involved", e.target.value)}
        />
        <div className="tooltip">{tt("lfi.who_tip")}</div>

        <label>{tt("lfi.what_label")}</label>
        <textarea
          placeholder={tt("lfi.what_placeholder")}
          value={form.what_happened}
          onChange={(e) => update("what_happened", e.target.value)}
        />
        <div className="tooltip">{tt("lfi.what_tip")}</div>

        <label>{tt("lfi.where_label")}</label>
        <input
          type="text"
          placeholder={tt("lfi.where_placeholder")}
          value={form.where_happened}
          onChange={(e) => update("where_happened", e.target.value)}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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

        <label>{tt("lfi.when_label")}</label>
        <input
          type="text"
          placeholder={tt("lfi.when_placeholder")}
          value={form.when_happened}
          onChange={(e) => update("when_happened", e.target.value)}
        />

        <label>{tt("lfi.notes_label")}</label>
        <textarea
          placeholder={tt("lfi.notes_placeholder")}
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
        />

        <label>{tt("lfi.related_label")}</label>
        <input
          type="text"
          placeholder={tt("lfi.related_placeholder")}
          value={form.related_to}
          onChange={(e) => update("related_to", e.target.value)}
        />
        <div className="tooltip">{tt("lfi.related_tip")}</div>

        <label>{tt("lfi.reliability_label")}</label>
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
        </div>

        {/* NEW: Pin category and status color for auto map pin pipeline */}
        <label>{tt("lfi.pin_category_label") || "Categorie du point (carte)"}</label>
        <select
          value={form.pin_category || "general"}
          onChange={(e) => update("pin_category", e.target.value)}
        >
          {Object.entries(PIN_CATEGORIES).map(([key, cat]) => (
            <option key={key} value={key}>{cat.symbol} {tt(`pin.cat.${key}`) || cat.labelEn || key}</option>
          ))}
        </select>

        <label>{tt("lfi.pin_status_label") || "Pin status color"}</label>
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
          {tt("map.colors") || "Rouge=hostile, Vert=ami, Jaune=inconnu, Bleu=neutre, Gris=inactif. Forme = categorie."}
        </div>

        <button type="submit" className="big-button" disabled={saving}>
          {saving ? tt("lfi.submit_saving") : editingId ? tt("lfi.update") : tt("lfi.submit")}
        </button>
      </form>

      {status && <div className="status">{status}</div>}

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
              className="list-item"
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
                  {translateReportType(l.report_type, tt)} - {l.what_happened?.slice(0, 70) || l.who_involved?.slice(0, 50) || tt("lfi.no_detail")}
                  {l.latitude && " GPS"}
                  {l.related_to && <span style={{color: 'var(--accent)'}}> | {tt("common.linked", {note: l.related_to.slice(0,30)})}</span>}
                </span>
              </div>
              {isFinalized && l.finalized_at && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, marginLeft: 2 }}>
                  {tt("lfi.finalized_at", { date: l.finalized_at.replace("T", " ").replace("Z", "") })}
                </div>
              )}
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

