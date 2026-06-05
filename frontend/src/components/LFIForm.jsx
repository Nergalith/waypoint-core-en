import React, { useEffect, useMemo, useState } from "react";
import { createLfi, exportLfi, finalizeLfi, reopenLfi } from "../api";
import { t, translateReportType } from "../i18n";

export default function LFIForm({ lang = "fr", onSaved, recentLfi, mapCoords, onMapCoordsUsed, focusedId }) {
  const tt = (key, vars = {}) => t(key, lang, vars);

  // Memoize to avoid recreating arrays/objects on every render (low memory/CPU on old hardware)
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

  const [form, setForm] = useState({
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
  });
  const [selectedRel, setSelectedRel] = useState("F");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [lockingId, setLockingId] = useState(null);
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
      await reopenLfi(id);
      if (onSaved) onSaved();
    } catch {
      setStatus(tt("lfi.unlock_error"));
      setTimeout(() => setStatus(""), 4200);
    } finally {
      setLockingId(null);
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
      await createLfi({ ...form, ...coords });
      setStatus(tt("lfi.success"));
      // reset most fields but keep type
      setForm({
        report_type: form.report_type,
        who_involved: "",
        what_happened: "",
        where_happened: "",
        when_happened: "",
        notes: "",
        related_to: "",
        source_reliability: "F",
        latitude: "",
        longitude: "",
      });
      setSelectedRel("F");
      if (onSaved) onSaved();
    } catch {
      setStatus(tt("lfi.error"));
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
      <h2>{tt("lfi.title")}</h2>
      <p style={{ color: "var(--soft)", marginBottom: 12 }}>
        {tt("lfi.intro")}
      </p>

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

        <button type="submit" className="big-button" disabled={saving} title={tt("lfi.submit")}>
          {saving ? tt("lfi.submit_saving") : tt("lfi.submit")}
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
                  {generating ? "…" : tt("lfi.generate_report_btn", { count: selectedIds.size })}
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
          const isChecked = selectedIds.has(l.id);
          return (
            <div
              key={l.id || i}
              id={`source-lfi-${l.id}`}
              className="list-item"
              style={{
                fontSize: 13,
                opacity: isFinalized ? 0.82 : 1,
                outline: selectMode && isChecked ? "1px solid #eab308" : "none",
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
                    🔒 {tt("lfi.status.finalized")}
                  </span>
                )}
                <span style={{ flex: 1 }}>
                  {translateReportType(l.report_type, tt)} — {l.what_happened?.slice(0, 70) || l.who_involved?.slice(0, 50) || tt("lfi.no_detail")}
                  {l.latitude && " 📍"}
                  {l.related_to && <span style={{color: 'var(--accent)'}}> • {tt("common.linked", {note: l.related_to.slice(0,30)})}</span>}
                </span>
              </div>
              {isFinalized && l.finalized_at && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, marginLeft: 2 }}>
                  {tt("lfi.finalized_at", { date: l.finalized_at.replace("T", " ").replace("Z", "") })}
                </div>
              )}
              {!selectMode && (
                <div style={{ marginTop: 5 }}>
                  {isFinalized ? (
                    <button
                      className="small-action"
                      onClick={() => handleReopen(l.id)}
                      disabled={isBusy}
                      style={{ fontSize: 11 }}
                    >
                      {isBusy ? "…" : tt("lfi.unlock_btn")}
                    </button>
                  ) : (
                    <button
                      className="small-action"
                      onClick={() => handleFinalize(l.id)}
                      disabled={isBusy}
                      style={{ fontSize: 11, background: "rgba(234,179,8,0.12)", borderColor: "#eab308" }}
                    >
                      {isBusy ? "…" : tt("lfi.finalize_btn")}
                    </button>
                  )}
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
