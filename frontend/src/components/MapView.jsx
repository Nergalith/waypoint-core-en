import React, { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import { createPin, deletePin } from "../api";
import { t } from "../i18n";
import { createPinIcon, DEFAULT_PIN_COLOR, PIN_CATEGORIES, STATUS_COLORS } from "../pinConstants";

const MAP_DEFAULT_CENTER = [20, 0];
const INITIAL_ZOOM = 2;
const OBJECT_SOURCES = ["person", "vehicle", "group", "location", "event"];
const DEFAULT_LAYER_VISIBILITY = { pins: true };

export default function MapView({ lang = "en", lfiList, photoList, documentList, objectList = [], pinList, focusCoordinates, refreshAll, onUseCoordinates, onOpenSource }) {
  const tt = (key, vars = {}) => t(key, lang, vars);

  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const layersRef = useRef({ pins: null });
  const layerVisibilityRef = useRef(DEFAULT_LAYER_VISIBILITY);
  const pickCoordsModeRef = useRef(false);
  const [status, setStatus] = useState(tt("map.status_ready"));
  const [showHelp, setShowHelp] = useState(false);
  const [pickCoordsMode, setPickCoordsMode] = useState(false);
  const [layerVisibility, setLayerVisibility] = useState(DEFAULT_LAYER_VISIBILITY);
  const [pendingPin, setPendingPin] = useState(null);
  const [pinLabel, setPinLabel] = useState("");
  const [pinCategory, setPinCategory] = useState("general");
  const [pinStatusColor, setPinStatusColor] = useState(DEFAULT_PIN_COLOR);
  const [pinSaving, setPinSaving] = useState(false);

  useEffect(() => {
    pickCoordsModeRef.current = pickCoordsMode;
  }, [pickCoordsMode]);

  useEffect(() => {
    layerVisibilityRef.current = layerVisibility;
    applyLayerVisibility();
  }, [layerVisibility]);

  const allGeoItems = React.useMemo(() => {
    const items = [];

    (lfiList || []).forEach((l) => {
      if (l.latitude != null && l.longitude != null) {
        items.push({
          id: `lfi-${l.id}`,
          lat: l.latitude,
          lon: l.longitude,
          label: `${l.report_type}: ${l.what_happened?.slice(0, 45) || l.who_involved?.slice(0, 35) || tt("chrono.lfi")}`,
          color: DEFAULT_PIN_COLOR,
          category: "incident",
          source: "lfi",
          sourceId: l.id,
          reliability: l.source_reliability,
          sourceLabel: tt("object.field_report_label", { id: l.id, text: l.what_happened || l.who_involved || tt("lfi.no_detail") }),
        });
      }
    });

    (photoList || []).forEach((p) => {
      if (p.latitude != null && p.longitude != null) {
        items.push({
          id: `photo-${p.id}`,
          lat: p.latitude,
          lon: p.longitude,
          label: `${tt("chrono.photo")} ${p.original_filename?.slice(0, 28)}`,
          color: DEFAULT_PIN_COLOR,
          category: "document",
          source: "photo",
          sourceId: p.id,
          sourceLabel: tt("object.photo_label", { id: p.id, text: p.original_filename }),
        });
      }
    });

    const documentsById = new Map((documentList || []).map((doc) => [Number(doc.id), doc]));

    (pinList || []).forEach((pin) => {
      if (pin.source === "manual" || pin.source === "document") {
        const doc = pin.source === "document" ? documentsById.get(Number(pin.source_id)) : null;
        items.push({
          id: `pin-${pin.id}`,
          lat: pin.latitude,
          lon: pin.longitude,
          label: pin.label || tt("map.prompt_default"),
          color: pin.color || DEFAULT_PIN_COLOR,
          category: pin.category || (pin.source === "document" ? "document" : "general"),
          source: pin.source,
          sourceId: pin.source === "document" ? pin.source_id : pin.id,
          sourceLabel: doc ? tt("object.document_label", { id: doc.id, text: doc.original_filename }) : undefined,
        });
      }
    });

    (objectList || []).forEach((object) => {
      if (object.latitude != null && object.longitude != null) {
        items.push({
          id: `object-${object.id}`,
          lat: object.latitude,
          lon: object.longitude,
          label: object.name || tt(`object.${object.object_type}`),
          color: object.pin_color || DEFAULT_PIN_COLOR,
          category: object.object_type === "event" ? "incident" : object.object_type,
          source: object.object_type,
          sourceId: object.id,
          sourceLabel: tt("object.field_object_label", { id: object.id, text: object.name || tt(`object.${object.object_type}`) }),
        });
      }
    });

    return items;
  }, [lfiList, photoList, documentList, objectList, pinList, lang]);

  useEffect(() => {
    if (leafletMap.current || !mapRef.current) return;

    if (!L) {
      setStatus(tt("map.leaflet_error"));
      return;
    }

    const map = L.map(mapRef.current, {
      center: MAP_DEFAULT_CENTER,
      zoom: INITIAL_ZOOM,
      zoomControl: true,
      attributionControl: false,
      preferCanvas: true,
      renderer: L.canvas({ padding: 0.25 }),
    });

    layersRef.current = { pins: L.layerGroup().addTo(map) };
    applyLayerVisibility(map);
    leafletMap.current = map;
    setStatus(tt("map.status_ready"));

    map.on("click", async (e) => {
      const { lat, lng } = e.latlng;
      if (pickCoordsModeRef.current) {
        if (onUseCoordinates) {
          onUseCoordinates({
            latitude: Number(lat.toFixed(6)),
            longitude: Number(lng.toFixed(6)),
          });
        }
        pickCoordsModeRef.current = false;
        setPickCoordsMode(false);
        setStatus(tt("map.status_coords_sent", { lat: lat.toFixed(4), lon: lng.toFixed(4) }));
        return;
      }

      setPinLabel("");
      setPinCategory("general");
      setPinStatusColor(DEFAULT_PIN_COLOR);
      setPendingPin({
        lat: parseFloat(lat.toFixed(6)),
        lon: parseFloat(lng.toFixed(6)),
      });
    });

    renderPins(allGeoItems);

    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (leafletMap.current) {
      renderPins(allGeoItems);
    }
  }, [allGeoItems]);

  useEffect(() => {
    const map = leafletMap.current;
    if (!map || !focusCoordinates?.latitude || !focusCoordinates?.longitude) return;
    const lat = Number(focusCoordinates.latitude);
    const lon = Number(focusCoordinates.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    map.setView([lat, lon], Math.max(map.getZoom(), 10), { animate: true });
    setStatus(tt("map.status_focus", { lat: lat.toFixed(4), lon: lon.toFixed(4) }));
  }, [focusCoordinates]);

  function renderPins(items) {
    const map = leafletMap.current;
    if (!map || !L || !layersRef.current.pins) return;

    const group = layersRef.current.pins;
    group.clearLayers();

    items.forEach((item) => {
      const marker = L.marker([item.lat, item.lon], {
        icon: createPinIcon(item.category, item.color),
      });

      const popupHtml = `
        <div style="font-size:13px; max-width:220px">
          <strong>${escapeHtml(item.label)}</strong><br/>
          <span style="color:#8ca1ad">${Number(item.lat).toFixed(5)}, ${Number(item.lon).toFixed(5)}</span><br/>
          ${item.reliability ? `<span style="background:#374151;color:white;padding:1px 5px;border-radius:3px;">${tt("rel.pill", { code: item.reliability })}</span>` : ""}
          <br/><small style="color:#8ca1ad">${escapeHtml(item.sourceLabel || item.source.toUpperCase())}</small>
        </div>
      `;
      marker.bindPopup(popupHtml);

      if ((item.source === "lfi" || item.source === "photo" || item.source === "document" || isObjectSource(item.source)) && item.sourceId) {
        marker.on("popupopen", () => {
          setTimeout(() => {
            const container = marker.getPopup().getElement();
            if (container && !container.querySelector(".source-btn")) {
              const btn = document.createElement("button");
              btn.textContent = item.source === "lfi" ? tt("map.open_lfi") : (item.source === "photo" ? tt("map.open_photo") : (item.source === "document" ? tt("map.open_document") : tt("map.open_object")));
              btn.className = "source-btn";
              btn.style.cssText = "margin-top:6px;padding:4px 8px;font-size:11px;background:#122230;color:#edf5f8;border:1px solid #42c8ff;border-radius:4px;cursor:pointer";
              btn.onclick = () => {
                if (onOpenSource) onOpenSource(item.source, item.sourceId);
                marker.closePopup();
              };
              const content = container.querySelector(".leaflet-popup-content");
              if (content) content.appendChild(btn);
            }
          }, 60);
        });
      }

      if (item.source === "manual" && item.sourceId) {
        marker.on("popupopen", () => {
          setTimeout(() => {
            const container = marker.getPopup().getElement();
            if (container && !container.querySelector(".del-btn")) {
              const btn = document.createElement("button");
              btn.textContent = tt("map.delete_btn");
              btn.className = "del-btn";
              btn.style.cssText = "margin-top:6px;padding:4px 8px;font-size:11px;background:#2a1414;color:#ffd7d7;border:1px solid #ff5a4f;border-radius:4px;cursor:pointer";
              btn.onclick = async () => {
                try {
                  await deletePin(item.sourceId);
                  if (refreshAll) refreshAll();
                  marker.closePopup();
                } catch {}
              };
              const content = container.querySelector(".leaflet-popup-content");
              if (content) content.appendChild(btn);
            }
          }, 60);
        });
      }

      marker.addTo(group);
    });

    applyLayerVisibility();
    setStatus(tt("map.status_pins", { count: items.length }));
  }

  function centerOnDefault() {
    const map = leafletMap.current;
    if (!map) return;
    map.setView(MAP_DEFAULT_CENTER, INITIAL_ZOOM);
  }

  function clearManualPins() {
    const manuals = (pinList || []).filter((p) => p.source === "manual");
    if (manuals.length === 0) return;
    if (!confirm(tt("map.confirm_delete", { count: manuals.length }))) return;
    Promise.all(manuals.map((p) => deletePin(p.id))).then(() => {
      if (refreshAll) refreshAll();
    });
  }

  async function handleModalSave() {
    if (!pendingPin || pinSaving) return;
    setPinSaving(true);
    try {
      await createPin({
        latitude: pendingPin.lat,
        longitude: pendingPin.lon,
        label: pinLabel.trim() || tt("map.prompt_default"),
        source: "manual",
        category: pinCategory,
        color: pinStatusColor,
      });
      setStatus(tt("map.status_added", { lat: pendingPin.lat.toFixed(4), lon: pendingPin.lon.toFixed(4) }));
      if (refreshAll) await refreshAll();
      setPendingPin(null);
    } catch (err) {
      setStatus(tt("map.status_error"));
    } finally {
      setPinSaving(false);
    }
  }

  function applyLayerVisibility(map = leafletMap.current) {
    if (!map || !layersRef.current.pins) return;
    const visible = layerVisibilityRef.current.pins !== false;
    if (visible && !map.hasLayer(layersRef.current.pins)) layersRef.current.pins.addTo(map);
    if (!visible && map.hasLayer(layersRef.current.pins)) map.removeLayer(layersRef.current.pins);
  }

  function bringPinsToFront() {
    layersRef.current.pins?.eachLayer((layer) => {
      if (layer.bringToFront) layer.bringToFront();
    });
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{tt("map.title")}</h2>
        <div className="map-actions">
          <button className="small-action" onClick={centerOnDefault} style={{ marginRight: 6 }}>{tt("map.center")}</button>
          <button
            className="small-action"
            onClick={() => {
              setPickCoordsMode((v) => !v);
              setStatus(!pickCoordsMode ? tt("map.status_pick_coords") : tt("map.status_ready"));
            }}
            style={{ marginRight: 6, background: pickCoordsMode ? "rgba(41, 211, 125, 0.18)" : "var(--card)", color: "var(--text)", borderColor: pickCoordsMode ? "var(--success)" : "var(--border)" }}
          >
            {pickCoordsMode ? tt("map.pick_cancel") : tt("map.pick_coords")}
          </button>
          <button className="small-action" onClick={clearManualPins} style={{ background: "rgba(255, 90, 79, 0.14)", color: "var(--text)", borderColor: "var(--danger)" }}>{tt("map.clear")}</button>
          <button className="small-action" onClick={() => setShowHelp(!showHelp)} style={{ marginLeft: 6 }}>{tt("map.help")}</button>
        </div>
      </div>
      <p className="tab-intro">{tt("map.intro")}</p>

      <div className="map-container">
        <div id="map" ref={mapRef} />
      </div>

      <div style={{ fontSize: 12, marginTop: 6, color: "var(--soft)" }}>
        {status}
      </div>

      {showHelp && (
        <div className="tooltip" style={{ marginTop: 8 }}>
          <span dangerouslySetInnerHTML={{ __html: tt("map.help_text") }} />
        </div>
      )}

      <div style={{ fontSize: 11, marginTop: 8, color: "var(--muted)" }}>
        <span dangerouslySetInnerHTML={{ __html: tt("map.colors") }} />
      </div>

      {pendingPin && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 9999,
        }}>
          <div style={{
            background: "var(--card)", border: "1px solid var(--border)",
            borderRadius: 8, padding: 20, width: 360, maxWidth: "95vw",
            maxHeight: "90vh", overflowY: "auto",
          }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>{tt("map.modal_title")}</h3>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 14 }}>
              {pendingPin.lat.toFixed(5)}, {pendingPin.lon.toFixed(5)}
            </div>

            <label style={{ display: "block", fontSize: 12, color: "var(--soft)", marginBottom: 4 }}>
              {tt("map.modal_label")}
            </label>
            <input
              type="text"
              value={pinLabel}
              onChange={(e) => setPinLabel(e.target.value)}
              placeholder={tt("map.modal_label_placeholder")}
              onKeyDown={(e) => { if (e.key === "Enter") handleModalSave(); if (e.key === "Escape") setPendingPin(null); }}
              autoFocus
              style={{
                width: "100%", boxSizing: "border-box", marginBottom: 16,
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 4, padding: "6px 8px", color: "var(--text)", fontSize: 13,
              }}
            />

            <div style={{ fontSize: 12, color: "var(--soft)", marginBottom: 6 }}>
              {tt("map.modal_category")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, marginBottom: 16 }}>
              {Object.entries(PIN_CATEGORIES).map(([key, cat]) => (
                <button
                  key={key}
                  onClick={() => setPinCategory(key)}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "5px 6px", fontSize: 11, textAlign: "left",
                    background: pinCategory === key ? "rgba(234,179,8,0.15)" : "var(--bg)",
                    border: `1px solid ${pinCategory === key ? "#eab308" : "var(--border)"}`,
                    borderRadius: 4, color: "var(--text)", cursor: "pointer",
                  }}
                >
                  <span style={{ fontSize: 13, flexShrink: 0 }}>{cat.symbol}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {tt(`pin.cat.${key}`)}
                  </span>
                </button>
              ))}
            </div>

            <div style={{ fontSize: 12, color: "var(--soft)", marginBottom: 6 }}>
              {tt("map.modal_status")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 20 }}>
              {Object.entries(STATUS_COLORS).map(([key, c]) => (
                <button
                  key={key}
                  onClick={() => setPinStatusColor(c.hex)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "5px 8px",
                    background: pinStatusColor === c.hex ? "rgba(255,255,255,0.07)" : "transparent",
                    border: `1px solid ${pinStatusColor === c.hex ? "var(--border)" : "transparent"}`,
                    borderRadius: 4, color: "var(--text)", cursor: "pointer", textAlign: "left",
                  }}
                >
                  <span style={{
                    width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                    background: c.hex, border: "1.5px solid rgba(255,255,255,0.25)",
                    display: "inline-block",
                  }} />
                  <span style={{ fontSize: 12 }}>{tt(`pin.status.${key}`)}</span>
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="small-action" onClick={() => setPendingPin(null)} disabled={pinSaving}>
                {tt("map.modal_cancel")}
              </button>
              <button
                className="small-action"
                onClick={handleModalSave}
                disabled={pinSaving}
                style={{ background: "rgba(234,179,8,0.18)", borderColor: "#eab308", color: "var(--text)" }}
              >
                {pinSaving ? "…" : tt("map.modal_save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function isObjectSource(source) {
  return OBJECT_SOURCES.includes(source);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
