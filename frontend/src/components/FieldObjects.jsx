import React, { useEffect, useMemo, useState } from "react";
import { createFieldObject } from "../api";
import { t } from "../i18n";
import { PIN_CATEGORIES, STATUS_COLORS } from "../pinConstants";

const OBJECT_TYPES = ["person", "vehicle", "group", "location", "event"];
const STATUSES = ["active", "unknown", "archived"];

export default function FieldObjects({
  lang = "en",
  objects = [],
  links = [],
  lfiList = [],
  photoList = [],
  documents = [],
  focusedId,
  onCreated,
  onOpenSource,
  onShowOnMap,
}) {
  const tt = (key, vars = {}) => t(key, lang, vars);
  const [form, setForm] = useState({
    object_type: "vehicle",
    name: "",
    description: "",
    notes: "",
    latitude: "",
    longitude: "",
    status: "unknown",
    pin_category: "general",
    pin_color: "#eab308",
  });
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState(null);

  const linkContext = useMemo(() => {
    return buildLinkContext(links, lfiList, photoList, documents, objects, tt);
  }, [links, lfiList, photoList, documents, objects, lang]);

  useEffect(() => {
    if (!focusedId?.id) return;
    const focusedObject = objects.find((item) => String(item.id) === String(focusedId.id));
    if (focusedObject) setSelected(focusedObject);
    const element = document.getElementById(`source-object-${focusedId.id}`);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("source-highlight");
    const timer = setTimeout(() => element.classList.remove("source-highlight"), 2800);
    return () => clearTimeout(timer);
  }, [focusedId, objects]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function parseCoordinates() {
    const hasLat = String(form.latitude).trim() !== "";
    const hasLon = String(form.longitude).trim() !== "";
    if (!hasLat && !hasLon) return { latitude: null, longitude: null };
    if (hasLat !== hasLon) throw new Error(tt("objects.coord_pair_error"));
    const latitude = Number(form.latitude);
    const longitude = Number(form.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error(tt("objects.coord_number_error"));
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new Error(tt("objects.coord_range_error"));
    return { latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) };
  }

  async function submit(e) {
    e.preventDefault();
    setStatus("");
    if (!form.name.trim()) {
      setStatus(tt("objects.name_required"));
      return;
    }
    let coords;
    try {
      coords = parseCoordinates();
    } catch (err) {
      setStatus(err.message);
      return;
    }
    try {
      await createFieldObject({
        object_type: form.object_type,
        name: form.name,
        description: form.description,
        notes: form.notes,
        status: form.status,
        pin_category: form.pin_category || "general",
        pin_color: form.pin_color || "#eab308",
        ...coords,
      });
      setStatus(tt("objects.created"));
      setForm((current) => ({
        ...current,
        name: "",
        description: "",
        notes: "",
        latitude: "",
        longitude: "",
        status: "unknown",
        pin_category: current.pin_category || "general",
        pin_color: current.pin_color || "#eab308",
      }));
      if (onCreated) await onCreated();
    } catch {
      setStatus(tt("objects.error"));
    }
  }

  const selectedLinks = selected ? linkContext.byObjectKey.get(objectKey(selected)) || [] : [];

  return (
    <div className="card">
      <h2>{tt("objects.title")}</h2>
      <p style={{ color: "var(--soft)" }}>{tt("objects.intro")}</p>

      <form onSubmit={submit} className="object-form">
        <div>
          <label>{tt("objects.type")}</label>
          <select value={form.object_type} onChange={(e) => update("object_type", e.target.value)}>
            {OBJECT_TYPES.map((value) => <option key={value} value={value}>{tt(`object.${value}`)}</option>)}
          </select>
        </div>
        <div>
          <label>{tt("objects.name")}</label>
          <input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder={tt("objects.name_placeholder")} />
        </div>
        <div>
          <label>{tt("objects.status")}</label>
          <select value={form.status} onChange={(e) => update("status", e.target.value)}>
            {STATUSES.map((value) => <option key={value} value={value}>{tt(`objects.status.${value}`)}</option>)}
          </select>
        </div>
        <div className="object-form-wide">
          <label>{tt("objects.description")}</label>
          <input value={form.description} onChange={(e) => update("description", e.target.value)} placeholder={tt("objects.description_placeholder")} />
        </div>
        <div className="object-form-wide">
          <label>{tt("objects.notes")}</label>
          <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder={tt("objects.notes_placeholder")} />
        </div>
        <div>
          <label>{tt("lfi.lat_label")}</label>
          <input value={form.latitude} onChange={(e) => update("latitude", e.target.value)} placeholder={tt("lfi.lat_placeholder")} inputMode="decimal" />
        </div>
        <div>
          <label>{tt("lfi.lon_label")}</label>
          <input value={form.longitude} onChange={(e) => update("longitude", e.target.value)} placeholder={tt("lfi.lon_placeholder")} inputMode="decimal" />
        </div>

        {/* Pin category/color for map pipeline (same as reports) */}
        <div>
          <label>{tt("objects.pin_category_label") || "CatÃ©gorie point carte"}</label>
          <select value={form.pin_category || "general"} onChange={(e) => update("pin_category", e.target.value)}>
            {Object.entries(PIN_CATEGORIES).map(([k, c]) => (
              <option key={k} value={k}>{c.symbol} {tt(`pin.cat.${k}`) || k}</option>
            ))}
          </select>
        </div>
        <div>
          <label>{tt("objects.pin_status_label") || "Couleur statut"}</label>
          <div style={{display:'flex', gap:4, flexWrap:'wrap'}}>
            {Object.entries(STATUS_COLORS).map(([k, c]) => (
              <button type="button" key={k} onClick={() => update("pin_color", c.hex)} title={tt(`pin.status.${k}`)||k}
                style={{width:22,height:22,borderRadius:3,background:c.hex, border: (form.pin_color===c.hex)?'2px solid #fff':'1px solid #555', cursor:'pointer'}} />
            ))}
          </div>
        </div>

        <button className="big-button" type="submit" title={tt("objects.create")}>{tt("objects.create")}</button>
      </form>

      {status && <div className="status">{status}</div>}

      <div className="object-workspace">
        <div className="object-list">
          {objects.length === 0 && <div className="empty-state">{tt("objects.empty")}</div>}
          {objects.map((item) => (
            <button
              key={item.id}
              id={`source-object-${item.id}`}
              type="button"
              className={`object-row ${selected?.id === item.id ? "selected" : ""}`}
              title={tt("objects.open_detail")}
              onClick={() => setSelected(item)}
            >
              <span className="object-pill">{tt(`object.${item.object_type}`)}</span>
              <strong>{item.name}</strong>
              <span>{tt(`objects.status.${item.status || "unknown"}`)}</span>
              {item.latitude != null && item.longitude != null && <span>{tt("objects.has_position")}</span>}
            </button>
          ))}
        </div>

        <div className="object-detail">
          {!selected && <p>{tt("objects.select_hint")}</p>}
          {selected && (
            <>
              <h3>{selected.name}</h3>
              <span className="object-pill">{tt(`object.${selected.object_type}`)}</span>
              <div className="detail-line">{tt(`objects.status.${selected.status || "unknown"}`)}</div>
              {selected.description && <div className="detail-line"><strong>{tt("objects.description")}:</strong> {selected.description}</div>}
              {selected.notes && <div className="detail-note">{selected.notes}</div>}
              {selected.latitude != null && selected.longitude != null && (
                <div className="detail-line">
                  {Number(selected.latitude).toFixed(5)}, {Number(selected.longitude).toFixed(5)}
                </div>
              )}
              <div className="detail-actions">
                {selected.latitude != null && selected.longitude != null && (
                  <button className="small-action" title={tt("links.show_on_map")} onClick={() => onShowOnMap?.({ latitude: selected.latitude, longitude: selected.longitude })}>
                    {tt("links.show_on_map")}
                  </button>
                )}
              </div>

              <h3 style={{ marginTop: 16 }}>{tt("objects.linked_title")}</h3>
              {selectedLinks.length === 0 && <p>{tt("objects.no_links")}</p>}
              {selectedLinks.map((link) => (
                <div key={link.id} className="object-link-row">
                  <span className="relationship-pill">{tt(`relationship.${link.relationship}`)}</span>
                  <strong>{link.otherLabel}</strong>
                  <span className="object-pill">{tt(`object.${link.otherType}`)}</span>
                  {link.notes && <span className="link-note">{link.notes}</span>}
                  {canOpen(link.otherType, link.otherId) && (
                    <button className="small-action" title={tt("links.open_source")} onClick={() => onOpenSource?.(link.otherType, link.otherId)}>
                      {tt("links.open_source")}
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function buildLinkContext(links, lfiList, photoList, documents, objects, tt) {
  const labels = new Map();
  (lfiList || []).forEach((lfi) => labels.set(`field_report:${lfi.id}`, tt("object.field_report_label", { id: lfi.id, text: lfi.what_happened || lfi.who_involved || tt("lfi.no_detail") })));
  (photoList || []).forEach((photo) => labels.set(`photo:${photo.id}`, tt("object.photo_label", { id: photo.id, text: photo.original_filename })));
  (documents || []).forEach((doc) => labels.set(`document:${doc.id}`, tt("object.document_label", { id: doc.id, text: doc.original_filename })));
  (objects || []).forEach((item) => labels.set(objectKey(item), tt("object.field_object_label", { id: item.id, text: item.name })));

  const byObjectKey = new Map();
  (links || []).forEach((link) => {
    const sourceKey = `${link.source_type}:${link.source_id}`;
    const targetKey = `${link.target_type}:${link.target_id}`;
    addLinkSide(byObjectKey, labels, link, sourceKey, targetKey, link.target_type, link.target_id, link.target_label);
    addLinkSide(byObjectKey, labels, link, targetKey, sourceKey, link.source_type, link.source_id, link.source_label);
  });
  return { byObjectKey };
}

function addLinkSide(byObjectKey, labels, link, selfKey, otherKey, otherType, otherId, fallbackLabel) {
  if (!["person", "vehicle", "group", "location", "event"].some((type) => selfKey.startsWith(`${type}:`))) return;
  if (!byObjectKey.has(selfKey)) byObjectKey.set(selfKey, []);
  byObjectKey.get(selfKey).push({
    id: `${link.id}-${selfKey}`,
    relationship: normalizeRelationship(link.relationship_type),
    otherType,
    otherId,
    otherLabel: labels.get(otherKey) || fallbackLabel,
    notes: link.notes,
  });
}

function objectKey(item) {
  return `${item.object_type}:${item.id}`;
}

function canOpen(type, id) {
  return ["field_report", "photo", "document", "person", "vehicle", "group", "location", "event"].includes(type) && id;
}

function normalizeRelationship(value) {
  return String(value || "related_to").toLowerCase().replace(/\s+/g, "_");
}

