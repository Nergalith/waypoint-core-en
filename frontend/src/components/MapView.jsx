import React, { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import { addMap, createPin, deletePin, deleteTrack, getMaps, getTracks, importAar, mapTileUrl } from "../api";
import { t } from "../i18n";
import { createPinIcon, DEFAULT_PIN_COLOR, PIN_CATEGORIES, STATUS_COLORS } from "../pinConstants";
import { triggerGlobalRefresh } from "../utils/refreshBus";
import { chooseMapForTrack, LAST_MAP_STORAGE_KEY } from "../utils/mapSelection";

const MAP_DEFAULT_CENTER = [20, 0];
const INITIAL_ZOOM = 2;
const MAP_PACKAGE_BASE = "/maps/test/";
const OBJECT_SOURCES = ["person", "vehicle", "group", "location", "event"];
const DEFAULT_LAYER_VISIBILITY = {
  prefectures: false,
  roads: false,
  rivers: false,
  places: false,
  pins: true,
  tracks: true,
};
const CHUNK_SIZE = 120;
const DEV_MAP_LOG = import.meta.env?.DEV;
const TRACK_COLOR_STORAGE_PREFIX = "track_color_";
const TRACK_COLOR_PALETTE = [
  "#42c8ff",
  "#ff6b35",
  "#29d37d",
  "#f6a43a",
  "#d946ef",
  "#38bdf8",
  "#f43f5e",
  "#a3e635",
  "#facc15",
  "#818cf8",
];

export default function MapView({ lang = "en", lfiList, photoList, documentList, objectList = [], pinList, focusCoordinates, refreshAll, reloadToken = 0, onUseCoordinates, onOpenSource }) {
  const tt = (key, vars = {}) => t(key, lang, vars);

  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const layersRef = useRef({ pins: null, country: null, prefectures: null, roads: null, rivers: null, places: null, borders: null, tracks: null });
  const trackLayersRef = useRef({});
  const trackPolylinesRef = useRef({});
  const trackColorsRef = useRef(loadStoredTrackColors());
  const trackVisibilityRef = useRef({});
  const layerVisibilityRef = useRef(DEFAULT_LAYER_VISIBILITY);
  const packageBoundsRef = useRef(null);
  const mapsRef = useRef([]);
  const baseMapLayerRef = useRef(null);
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
  const [tracks, setTracks] = useState([]);
  const [trackVisibility, setTrackVisibility] = useState({});
  const [trackColors, setTrackColors] = useState(trackColorsRef.current);
  const [showAarImport, setShowAarImport] = useState(false);
  const [showTrackManager, setShowTrackManager] = useState(false);
  const [deletingTrackId, setDeletingTrackId] = useState(null);
  const [maps, setMaps] = useState([]);
  const [selectedMapId, setSelectedMapId] = useState("");
  const [mapNotice, setMapNotice] = useState("");
  const [addingMap, setAddingMap] = useState(false);

  useEffect(() => {
    pickCoordsModeRef.current = pickCoordsMode;
  }, [pickCoordsMode]);

  useEffect(() => {
    layerVisibilityRef.current = layerVisibility;
    applyLayerVisibility();
  }, [layerVisibility]);

  useEffect(() => {
    trackVisibilityRef.current = trackVisibility;
    applyLayerVisibility();
  }, [trackVisibility]);

  useEffect(() => {
    if (leafletMap.current) renderTracks(tracks, leafletMap.current, trackColors);
  }, [trackColors]);

  const allGeoItems = React.useMemo(() => {
    const items = [];

    // Photos (GPS) remain synthesized (special ingest pins, not in map_pins table)
    (photoList || []).forEach((p) => {
      if (p.latitude != null && p.longitude != null) {
        items.push({
          id: `photo-${p.id}`,
          lat: p.latitude,
          lon: p.longitude,
          label: `${tt("chrono.photo")} ${p.original_filename?.slice(0, 28)}`,
          color: "#42c8ff", // photo blue per existing behavior
          category: "general",
          source: "photo",
          sourceId: p.id,
          sourceLabel: tt("object.photo_label", { id: p.id, text: p.original_filename }),
        });
      }
    });

    const documentsById = new Map((documentList || []).map((doc) => [Number(doc.id), doc]));

    // All pins now drive reports (field_report), objects (person/vehicle/...), manual, document.
    // This makes the report/object -> auto pin pipeline visible immediately.
    (pinList || []).forEach((pin) => {
      const isDoc = pin.source === "document";
      const doc = isDoc ? documentsById.get(Number(pin.source_id)) : null;
      const isReport = pin.source === "field_report";
      const isObj = ["person", "vehicle", "group", "location", "event"].includes(pin.source);
      const label = pin.label || tt("map.prompt_default");
      items.push({
        id: `pin-${pin.id}`,
        lat: pin.latitude,
        lon: pin.longitude,
        label: isReport ? label : (isObj ? label : label),
        color: pin.color || DEFAULT_PIN_COLOR,
        category: pin.category || (isDoc ? "document" : "general"),
        source: pin.source,
        sourceId: pin.source_id != null ? pin.source_id : pin.id,
        sourceLabel: isReport ? (label || tt("object.field_report_label", { id: pin.source_id, text: "" })) : (doc ? tt("object.document_label", { id: doc.id, text: doc.original_filename }) : undefined),
        reliability: isReport ? undefined : undefined,
      });
    });

    return items;
  }, [photoList, documentList, pinList, lang]);

  useEffect(() => {
    if (leafletMap.current || !mapRef.current) return;

    let map = null;
    try {
      if (!L) {
        setStatus(tt("map.leaflet_error"));
        return;
      }

      map = L.map(mapRef.current, {
        center: MAP_DEFAULT_CENTER,
        zoom: INITIAL_ZOOM,
        zoomControl: true,
        attributionControl: false,
        preferCanvas: true,
        renderer: L.canvas({ padding: 0.25 }),
      });

      layersRef.current = {
        country: L.layerGroup().addTo(map),
        prefectures: L.layerGroup(),
        roads: L.layerGroup(),
        rivers: L.layerGroup(),
        places: L.layerGroup(),
        borders: L.layerGroup(),
        pins: L.layerGroup(),
        tracks: L.layerGroup(),
      };
      trackLayersRef.current = {};
      trackPolylinesRef.current = {};
      packageBoundsRef.current = null;
      applyLayerVisibility(map);
      leafletMap.current = map;
      loadAvailableMaps(map).then(() => loadPatrolTracks(map));
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
    } catch (err) {
      mapLog("map init failed", err);
      setStatus("Map failed to initialize. Click Refresh or Try again.");
      if (map) {
        try { map.remove(); } catch {}
      }
      leafletMap.current = null;
      layersRef.current = { pins: null, country: null, prefectures: null, roads: null, rivers: null, places: null, borders: null, tracks: null };
      trackLayersRef.current = {};
      trackPolylinesRef.current = {};
    }

    return () => {
      if (leafletMap.current) {
        try { leafletMap.current.remove(); } catch {}
        leafletMap.current = null;
      }
      layersRef.current = { pins: null, country: null, prefectures: null, roads: null, rivers: null, places: null, borders: null, tracks: null };
      trackLayersRef.current = {};
      trackPolylinesRef.current = {};
    };
  }, [reloadToken]);

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

  async function loadPatrolTracks(map = leafletMap.current) {
    if (!map || !layersRef.current.tracks) return;
    try {
      const loaded = await getTracks();
      const safeTracks = Array.isArray(loaded) ? loaded : [];
      setTracks(safeTracks);
      const colors = ensureTrackColors(safeTracks);
      renderTracks(safeTracks, map, colors);
      const requestedMapName = safeTracks.find((track) => track?.map_package_name)?.map_package_name || "";
      const choice = chooseMapForTrack(mapsRef.current, requestedMapName, safeLocalStorageGet(LAST_MAP_STORAGE_KEY));
      if (choice.map) selectBaseMap(choice.map, map, false);
      if (choice.missingRequestedMap) {
        setMapNotice("Map for this patrol not found. Add map.");
      } else if (choice.map) {
        setMapNotice("");
      }
      const bounds = collectTrackBounds();
      if (bounds?.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    } catch (err) {
      mapLog("tracks load failed", err);
      setTracks([]);
      renderTracks([], map);
      setStatus("Patrol tracks could not be loaded. Map remains usable.");
    }
  }

  async function loadAvailableMaps(map = leafletMap.current) {
    try {
      const available = await getMaps();
      mapsRef.current = Array.isArray(available) ? available : [];
      setMaps(mapsRef.current);
      if (mapsRef.current.length === 0) {
        setSelectedMapId("");
        setMapNotice("No map installed. Add map.");
        return;
      }
      const choice = chooseMapForTrack(mapsRef.current, "", safeLocalStorageGet(LAST_MAP_STORAGE_KEY));
      if (choice.map) selectBaseMap(choice.map, map, false);
    } catch {
      mapsRef.current = [];
      setMaps([]);
      setMapNotice("No map installed. Add map.");
    }
  }

  function selectBaseMap(mapInfo, map = leafletMap.current, clearNotice = true) {
    if (!map || !mapInfo) return;
    if (baseMapLayerRef.current) map.removeLayer(baseMapLayerRef.current);
    baseMapLayerRef.current = L.tileLayer(mapTileUrl(mapInfo.id), {
      minZoom: mapInfo.minzoom ?? 0,
      maxZoom: mapInfo.maxzoom ?? 18,
      tileSize: 256,
      errorTileUrl: "",
    }).addTo(map);
    setSelectedMapId(mapInfo.id);
    try { localStorage.setItem(LAST_MAP_STORAGE_KEY, mapInfo.id); } catch {}
    if (clearNotice) setMapNotice("");
  }

  async function handleAddMap(file) {
    if (!file || addingMap) return;
    setAddingMap(true);
    try {
      const created = await addMap(file);
      await loadAvailableMaps();
      const installed = mapsRef.current.find((item) => item.id === created.id) || created;
      selectBaseMap(installed);
      setStatus(`Map added: ${installed.name}`);
    } catch (error) {
      setMapNotice(error.message || "Could not add map.");
    } finally {
      setAddingMap(false);
    }
  }

  function renderTracks(trackList, map = leafletMap.current, colorMap = trackColorsRef.current) {
    if (!map || !layersRef.current.tracks) return;
    try {
      layersRef.current.tracks.clearLayers();
      trackLayersRef.current = {};
      trackPolylinesRef.current = {};
      (Array.isArray(trackList) ? trackList : []).forEach((track, index) => {
        const trackId = getTrackId(track, index);
        const callsign = String(track?.callsign || "UNKNOWN").toUpperCase();
        const coords = Array.isArray(track?.geojson?.coordinates) ? track.geojson.coordinates : [];
        const latlngs = coords
          .filter((coord) => Array.isArray(coord) && coord.length >= 2)
          .map((coord) => [Number(coord[1]), Number(coord[0])])
          .filter(([lat, lon]) => isValidCoord(lat, lon));
        if (latlngs.length < 2) {
          console.warn(`Track ${callsign} skipped - insufficient valid coordinates (${latlngs.length})`);
          return;
        }
        const group = L.layerGroup().addTo(layersRef.current.tracks);
        const polyline = L.polyline(latlngs, { color: getTrackColor(track, index, colorMap), weight: 2.5, opacity: 0.9 })
          .bindPopup(`<b>${escapeHtml(callsign)}</b><br/>${escapeHtml(track.filename || "AAR import")}<br/>${escapeHtml(track.timestamp || "")}<br/>${Number(track.point_count || latlngs.length)} points`)
          .addTo(group);
        trackLayersRef.current[trackId] = group;
        trackPolylinesRef.current[trackId] = polyline;
      });
      const nextVisibility = {};
      Object.keys(trackLayersRef.current).forEach((trackId) => { nextVisibility[trackId] = trackVisibilityRef.current[trackId] !== false; });
      setTrackVisibility(nextVisibility);
      applyLayerVisibility(map);
    } catch (err) {
      mapLog("track render failed", err);
      trackLayersRef.current = {};
      trackPolylinesRef.current = {};
      setStatus("Patrol tracks could not be drawn. Map remains usable.");
    }
  }


  function ensureTrackColors(trackList) {
    const next = { ...trackColorsRef.current };
    const used = new Set(Object.values(next).map((value) => String(value).toLowerCase()));
    let changed = false;

    (trackList || []).forEach((track, index) => {
      const trackId = getTrackId(track, index);
      const storedColor = safeLocalStorageGet(trackColorKey(trackId));
      if (storedColor) {
        next[trackId] = storedColor;
        used.add(storedColor.toLowerCase());
        return;
      }
      if (next[trackId]) return;
      const paletteColor = TRACK_COLOR_PALETTE.find((color) => !used.has(color.toLowerCase()));
      const assigned = paletteColor || fallbackTrackColor(trackId, index);
      next[trackId] = assigned;
      used.add(assigned.toLowerCase());
      try { localStorage.setItem(trackColorKey(trackId), assigned); } catch {}
      changed = true;
    });

    if (changed) saveTrackColors(next);
    return next;
  }

  function saveTrackColors(next) {
    trackColorsRef.current = next;
    setTrackColors(next);
  }

  function updateTrackColor(trackId, color) {
    const normalized = String(trackId ?? "UNKNOWN");
    const next = { ...trackColorsRef.current, [normalized]: color };
    try { localStorage.setItem(trackColorKey(normalized), color); } catch {}
    saveTrackColors(next);
    const polyline = trackPolylinesRef.current[normalized];
    if (polyline?.setStyle) polyline.setStyle({ color });
  }

  function toggleTrackVisibility(trackId, visible) {
    const normalized = String(trackId ?? "UNKNOWN");
    const group = trackLayersRef.current[normalized];
    const parent = layersRef.current.tracks;
    const map = leafletMap.current;
    if (visible && layerVisibilityRef.current.tracks === false) {
      layerVisibilityRef.current = { ...layerVisibilityRef.current, tracks: true };
      setLayerVisibility((current) => ({ ...current, tracks: true }));
    }
    if (group && parent) {
      if (visible && !parent.hasLayer(group)) {
        group.addTo(parent);
        if (map && !map.hasLayer(parent)) parent.addTo(map);
      }
      if (!visible && parent.hasLayer(group)) parent.removeLayer(group);
    }
    const next = { ...trackVisibilityRef.current, [normalized]: visible };
    trackVisibilityRef.current = next;
    setTrackVisibility(next);
  }

  function setAllTrackVisibility(visible) {
    const next = {};
    Object.keys(trackLayersRef.current || {}).forEach((trackId) => {
      next[trackId] = visible;
      const group = trackLayersRef.current[trackId];
      const parent = layersRef.current.tracks;
      if (!group || !parent) return;
      if (visible && !parent.hasLayer(group)) group.addTo(parent);
      if (!visible && parent.hasLayer(group)) parent.removeLayer(group);
    });
    trackVisibilityRef.current = next;
    setTrackVisibility(next);
  }

  async function handleAarFile(file) {
    const result = await importAar(file);
    await loadPatrolTracks();
    triggerGlobalRefresh();
    return result;
  }

  function renderPins(items) {
    const map = leafletMap.current;
    if (!map || !L || !layersRef.current.pins) return;

    const group = layersRef.current.pins;
    group.clearLayers();

    items.forEach((item) => {
      if (!isValidCoord(item.lat, item.lon)) {
        console.warn(`Pin ${item.id ?? item.sourceId ?? "unknown"} skipped - invalid coordinates`);
        return;
      }

      const marker = L.marker([Number(item.lat), Number(item.lon)], {
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

      const canOpen = item.sourceId && (item.source === "field_report" || item.source === "lfi" || item.source === "photo" || item.source === "document" || isObjectSource(item.source));
      if (canOpen) {
        marker.on("popupopen", () => {
          setTimeout(() => {
            const container = marker.getPopup().getElement();
            if (container && !container.querySelector(".source-btn")) {
              const src = item.source === "field_report" ? "lfi" : item.source;
              const btn = document.createElement("button");
              btn.textContent = src === "lfi" ? tt("map.open_lfi") : (src === "photo" ? tt("map.open_photo") : (src === "document" ? tt("map.open_document") : tt("map.open_object")));
              btn.className = "source-btn";
              btn.style.cssText = "margin-top:6px;padding:4px 8px;font-size:11px;background:#122230;color:#edf5f8;border:1px solid #42c8ff;border-radius:4px;cursor:pointer";
              btn.onclick = () => {
                if (onOpenSource) onOpenSource(src, item.sourceId);
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
                  triggerGlobalRefresh();
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

  async function loadOfflineMapPackage(map) {
    const loadStart = performance.now();
    mapLog("map load start");
    try {
      const [metadata, admin0, admin1] = await Promise.all([
        fetchJson(`${MAP_PACKAGE_BASE}metadata.json`),
        fetchJson(`${MAP_PACKAGE_BASE}admin0.geojson`),
        fetchJson(`${MAP_PACKAGE_BASE}admin1_prefectures.geojson`),
      ]);

      mapLog("base layers fetched", {
        admin0: featureCount(admin0),
        admin1: featureCount(admin1),
      });

      const admin0Layer = await addGeoJsonChunked(admin0, layersRef.current.country, {
        style: {
          color: "#42c8ff",
          weight: 2.2,
          fillColor: "#0d2f3a",
          fillOpacity: 0.24,
        },
        onEachFeature: (feature, layer) => {
          const name = getName(feature.properties) || tt("map.car_popup");
          layer.bindPopup(`${escapeHtml(name)}<br/><small>${tt("map.car_popup")}</small>`);
        },
      }, "country");

      packageBoundsRef.current = admin0Layer.getBounds();
      if (packageBoundsRef.current.isValid()) {
        map.fitBounds(packageBoundsRef.current.pad(0.08));
      }

      await addGeoJsonChunked(admin1, layersRef.current.prefectures, {
        style: {
          color: "#2f6f80",
          weight: 0.9,
          fillOpacity: 0,
          dashArray: "4 4",
        },
        onEachFeature: (feature, layer) => {
          const name = getName(feature.properties);
          if (name) layer.bindTooltip(name, { permanent: true, direction: "center", className: "admin-label" });
        },
      }, "prefectures");

      applyLayerVisibility(map);
      bringPinsToFront();
      setStatus(tt("map.status_base"));
      mapLog("base layers ready", { ms: Math.round(performance.now() - loadStart) });

      await pause(80);
      await loadDeferredLayer("rivers", "waterways.geojson", {
        interactive: false,
        style: {
          color: "#3aaee8",
          weight: 0.8,
          opacity: 0.62,
        },
      });

      await pause(60);
      await loadDeferredLayer("roads", "roads.geojson", {
        interactive: false,
        style: (feature) => ({
          color: roadColor(feature.properties?.highway),
          weight: roadWeight(feature.properties?.highway),
          opacity: 0.72,
        }),
      });

      await pause(60);
      await loadDeferredLayer("places", "places.geojson", {
        pointToLayer: (feature, latlng) => {
          const place = feature.properties?.place;
          return L.circleMarker(latlng, {
            radius: place === "city" ? 4.8 : place === "town" ? 3.8 : 2.6,
            color: "#071118",
            weight: 0.8,
            fillColor: place === "city" ? "#d4a96a" : "#b8916a",
            fillOpacity: 0.86,
          });
        },
        onEachFeature: (feature, layer) => {
          const place = feature.properties?.place;
          const name = getName(feature.properties);
          if (name && (place === "city" || place === "town")) {
            layer.bindTooltip(name, { direction: "top", sticky: true });
          }
        },
      });

      await pause(40);
      await loadDeferredLayer("borders", "border_crossings.geojson", {
        pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
          radius: 4.8,
          color: "#f5c8a0",
          weight: 1,
          fillColor: "#d4704a",
          fillOpacity: 0.86,
        }),
        onEachFeature: (feature, layer) => {
          const name = getName(feature.properties) || tt("map.border_crossing");
          layer.bindTooltip(name, { direction: "top", sticky: true });
        },
      });

      const layerCount = metadata.layers?.length || 6;
      bringPinsToFront();
      mapLog("map load end", { ms: Math.round(performance.now() - loadStart) });
      setStatus(tt("map.status_package", { count: layerCount }));
    } catch (err) {
      mapLog("map load failed", err);
      setStatus(tt("map.status_package_error"));
    }
  }

  async function loadDeferredLayer(key, file, options) {
    const collection = await timedFetchJson(file);
    setStatus(tt("map.status_loading_layer", { layer: tt(`map.layer_${key}`) }));
    await addGeoJsonChunked(collection, layersRef.current[key], options, key);
    applyLayerVisibility();
    bringPinsToFront();
  }

  function centerOnDefaultMap() {
    const map = leafletMap.current;
    if (!map) return;
    const pinBounds = collectVisiblePinBounds();
    if (pinBounds?.isValid()) {
      map.fitBounds(pinBounds, { padding: [40, 40], maxZoom: 13 });
      setStatus("Centered on visible pins.");
      return;
    }
    if (packageBoundsRef.current?.isValid()) {
      map.fitBounds(packageBoundsRef.current.pad(0.08));
    } else {
      map.setView(MAP_DEFAULT_CENTER, INITIAL_ZOOM);
    }
    setStatus(tt("map.status_focus", { lat: MAP_DEFAULT_CENTER[0].toFixed(1), lon: MAP_DEFAULT_CENTER[1].toFixed(1) }) + " - test map");
  }

  function centerOnTracks() {
    const map = leafletMap.current;
    if (!map) return;
    const bounds = collectTrackBounds();
    if (bounds?.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
      setStatus("Centered on patrol tracks.");
    } else {
      setStatus("No patrol tracks to center on.");
    }
  }

  function collectVisiblePinBounds() {
    if (!layersRef.current.pins || !L || layerVisibilityRef.current.pins === false) return null;
    const latlngs = [];
    layersRef.current.pins.eachLayer((layer) => {
      if (layer.getLatLng) latlngs.push(layer.getLatLng());
    });
    return latlngs.length ? L.latLngBounds(latlngs) : null;
  }

  function collectTrackBounds() {
    if (!L) return null;
    const latlngs = [];
    Object.values(trackLayersRef.current || {}).forEach((group) => {
      if (!group?.eachLayer) return;
      group.eachLayer((layer) => {
        if (!layer.getLatLngs) return;
        flattenLatLngs(layer.getLatLngs()).forEach((latlng) => latlngs.push(latlng));
      });
    });
    return latlngs.length ? L.latLngBounds(latlngs) : null;
  }

  async function handleDeleteTrack(trackId) {
    if (deletingTrackId) return;
    setDeletingTrackId(trackId);
    try {
      await deleteTrack(trackId);
      setTracks((current) => (Array.isArray(current) ? current.filter((track) => track.id !== trackId) : []));
      const nextTracks = (Array.isArray(tracks) ? tracks : []).filter((track) => track.id !== trackId);
      renderTracks(nextTracks);
      triggerGlobalRefresh();
      setStatus("Patrol track deleted.");
    } catch {
      setStatus("Could not delete patrol track.");
    } finally {
      setDeletingTrackId(null);
    }
  }

  function clearManualPins() {
    const manuals = (pinList || []).filter((p) => p.source === "manual");
    if (manuals.length === 0) return;
    if (!confirm(tt("map.confirm_delete", { count: manuals.length }))) return;
    Promise.all(manuals.map((p) => deletePin(p.id))).then(() => {
      triggerGlobalRefresh();
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
      triggerGlobalRefresh();
      if (refreshAll) await refreshAll();
      setPendingPin(null);
    } catch (err) {
      setStatus(tt("map.status_error"));
    } finally {
      setPinSaving(false);
    }
  }

  function toggleLayer(key) {
    const nextVisible = !layerVisibilityRef.current[key];
    if (key === "tracks") setAllTrackVisibility(nextVisible);
    setLayerVisibility((current) => ({ ...current, [key]: nextVisible }));
  }

  function applyLayerVisibility(map = leafletMap.current) {
    if (!map) return;
    const visibility = layerVisibilityRef.current;
    Object.entries({
      prefectures: layersRef.current.prefectures,
      roads: layersRef.current.roads,
      rivers: layersRef.current.rivers,
      places: layersRef.current.places,
      borders: layersRef.current.borders,
      pins: layersRef.current.pins,
      tracks: layersRef.current.tracks,
    }).forEach(([key, layer]) => {
      if (!layer) return;
      const visible = key === "borders" ? true : visibility[key] !== false;
      if (visible && !map.hasLayer(layer)) layer.addTo(map);
      if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
    });
    Object.entries(trackLayersRef.current).forEach(([trackId, layer]) => {
      if (!layersRef.current.tracks) return;
      const visible = trackVisibilityRef.current[trackId] !== false;
      if (visible && !layersRef.current.tracks.hasLayer(layer)) layer.addTo(layersRef.current.tracks);
      if (!visible && layersRef.current.tracks.hasLayer(layer)) layersRef.current.tracks.removeLayer(layer);
    });
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
          <button className="small-action" title={tt("map.center")} onClick={centerOnDefaultMap} style={{ marginRight: 6 }}>{tt("map.center")}</button>
          <button className="small-action" title="Center on tracks" onClick={centerOnTracks} style={{ marginRight: 6 }}>Center on tracks</button>
          <button
            className="small-action"
            title={pickCoordsMode ? tt("map.pick_cancel") : tt("map.pick_coords")}
            onClick={() => {
              setPickCoordsMode((v) => !v);
              setStatus(!pickCoordsMode ? tt("map.status_pick_coords") : tt("map.status_ready"));
            }}
            style={{ marginRight: 6, background: pickCoordsMode ? "rgba(41, 211, 125, 0.18)" : "var(--card)", color: "var(--text)", borderColor: pickCoordsMode ? "var(--success)" : "var(--border)" }}
          >
            {pickCoordsMode ? tt("map.pick_cancel") : tt("map.pick_coords")}
          </button>
          <button className="small-action" title={tt("map.import_aar")} onClick={() => setShowAarImport(true)}>{tt("map.import_aar")}</button>
          <button className="small-action" title={tt("map.clear")} onClick={clearManualPins} style={{ background: "rgba(255, 90, 79, 0.14)", color: "var(--text)", borderColor: "var(--danger)" }}>{tt("map.clear")}</button>
          <button className="small-action" title={tt("map.help_title")} onClick={() => setShowHelp(!showHelp)} style={{ marginLeft: 6 }}>{tt("map.help")}</button>
        </div>
      </div>
      <p className="tab-intro">{tt("map.intro")}</p>

      <div className="map-picker">
        <label>
          <span>Offline map</span>
          <select
            value={selectedMapId}
            disabled={maps.length === 0}
            onChange={(event) => selectBaseMap(maps.find((item) => item.id === event.target.value))}
          >
            {maps.length === 0 && <option value="">No maps installed</option>}
            {maps.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="add-map-button">
          {addingMap ? "Adding map..." : "+ Add map"}
          <input
            type="file"
            accept=".mbtiles"
            disabled={addingMap}
            onChange={(event) => { handleAddMap(event.target.files?.[0]); event.target.value = ""; }}
          />
        </label>
      </div>
      {mapNotice && <div className="map-notice" role="status">{mapNotice}</div>}

      <div className="map-layer-toggles" aria-label={tt("map.layers")}>
        {["pins", "tracks"].map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={layerVisibility[key]}
              onChange={() => toggleLayer(key)}
            />
            {tt(`map.layer_${key}`)}
          </label>
        ))}
      </div>

      <div className="track-manager">
        <button
          type="button"
          className="small-action track-manager-toggle"
          onClick={() => setShowTrackManager((value) => !value)}
        >
          Patrol Tracks ({Array.isArray(tracks) ? tracks.length : 0})
        </button>
        {showTrackManager && (
          <div className="track-manager-list">
            {(!Array.isArray(tracks) || tracks.length === 0) && (
              <div className="empty-state">No patrol tracks imported yet.</div>
            )}
            {(Array.isArray(tracks) ? tracks : []).map((track, index) => {
              const callsign = String(track.callsign || "UNKNOWN").toUpperCase();
              const color = getTrackColor(track, index, trackColors);
              return (
                <div className="track-manager-row" key={track.id}>
                  <input
                    type="checkbox"
                    checked={trackVisibility[String(track.id)] ?? true}
                    onChange={(event) => toggleTrackVisibility(track.id, event.target.checked)}
                    title="Show or hide this track"
                  />
                  <input
                    type="color"
                    className="track-color-picker"
                    value={color}
                    onChange={(event) => updateTrackColor(track.id, event.target.value)}
                    title="Change track color"
                  />
                  <div className="track-manager-name">
                    <strong>{callsign}</strong>
                    <span>{track.filename || "AAR import"}</span>
                  </div>
                  <span>{Number(track.point_count || track.geojson?.coordinates?.length || 0)} pts</span>
                  <span>{track.timestamp || "unknown time"}</span>
                  <button
                    type="button"
                    className="small-action"
                    disabled={deletingTrackId === track.id}
                    onClick={() => handleDeleteTrack(track.id)}
                  >
                    {deletingTrackId === track.id ? "..." : "Delete"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

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

      {showAarImport && (
        <AARImport
          tt={tt}
          onClose={() => setShowAarImport(false)}
          onImport={handleAarFile}
        />
      )}

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
              <button
                className="small-action"
                onClick={() => setPendingPin(null)}
                disabled={pinSaving}
              >
                {tt("map.modal_cancel")}
              </button>
              <button
                className="small-action"
                onClick={handleModalSave}
                disabled={pinSaving}
                style={{ background: "rgba(234,179,8,0.18)", borderColor: "#eab308", color: "var(--text)" }}
              >
                {pinSaving ? "..." : tt("map.modal_save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function isValidCoord(lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}
function flattenLatLngs(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (Array.isArray(item) ? flattenLatLngs(item) : [item])).filter(Boolean);
}

function loadStoredTrackColors() {
  const colors = {};
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(TRACK_COLOR_STORAGE_PREFIX)) {
        colors[key.slice(TRACK_COLOR_STORAGE_PREFIX.length)] = localStorage.getItem(key);
      }
    }
  } catch {}
  return colors;
}

function trackColorKey(trackId) {
  return `${TRACK_COLOR_STORAGE_PREFIX}${trackId}`;
}

function getTrackId(track, index = 0) {
  return String(track?.id ?? `${track?.callsign || "track"}-${index}`);
}

function getTrackColor(track, index = 0, colorMap = {}) {
  const trackId = getTrackId(track, index);
  return colorMap[trackId] || safeLocalStorageGet(trackColorKey(trackId)) || fallbackTrackColor(trackId, index);
}

function fallbackTrackColor(trackId, index = 0) {
  if (TRACK_COLOR_PALETTE[index % TRACK_COLOR_PALETTE.length]) {
    return TRACK_COLOR_PALETTE[index % TRACK_COLOR_PALETTE.length];
  }
  let hash = 0;
  const value = String(trackId || "track");
  for (let i = 0; i < value.length; i += 1) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360}, 75%, 55%)`;
}

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function AARImport({ tt, onClose, onImport }) {
  const [status, setStatus] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  async function handleFile(file) {
    if (!file || loading) return;
    setLoading(true);
    setStatus(null);
    try {
      const data = await onImport(file);
      const message = data?.skipped ? (data.reason || "Track already imported - skipped") : tt("map.aar_imported", { callsigns: (data.callsigns || []).join(", ") });
      setStatus({ ok: true, message });
    } catch (err) {
      setStatus({ ok: false, message: tt("map.aar_error", { message: err.message || "Import failed" }) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="aar-overlay">
      <div className="aar-card">
        <div
          className="aar-dropzone"
          onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
          onDragOver={(e) => e.preventDefault()}
        >
          {loading ? tt("map.aar_importing") : tt("map.aar_drop")}
          <input
            type="file"
            accept=".zip,.kml,.gpx"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
        {status && <div className={`aar-status ${status.ok ? "ok" : "error"}`}>{status.message}</div>}
        <button className="small-action" onClick={onClose}>{tt("map.aar_close")}</button>
      </div>
    </div>
  );
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return response.json();
}

async function timedFetchJson(file) {
  const start = performance.now();
  const collection = await fetchJson(`${MAP_PACKAGE_BASE}${file}`);
  mapLog("layer fetched", {
    file,
    features: featureCount(collection),
    ms: Math.round(performance.now() - start),
  });
  return collection;
}

async function addGeoJsonChunked(collection, targetGroup, options, label) {
  const features = collection?.features || [];
  const start = performance.now();
  const layer = L.geoJSON(null, options).addTo(targetGroup);

  if (features.length === 0) {
    mapLog("layer rendered", { label, features: 0, ms: 0 });
    return layer;
  }

  for (let index = 0; index < features.length; index += CHUNK_SIZE) {
    layer.addData({
      type: "FeatureCollection",
      features: features.slice(index, index + CHUNK_SIZE),
    });
    await pause(0);
  }

  mapLog("layer rendered", {
    label,
    features: features.length,
    ms: Math.round(performance.now() - start),
  });
  return layer;
}

function featureCount(collection) {
  return collection?.features?.length || 0;
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapLog(message, detail = {}) {
  if (DEV_MAP_LOG) {
    console.info(`[Waypoint map] ${message}`, detail);
  }
}

function getName(properties = {}) {
  return properties.name || properties.adm1_name || properties.adm0_name || properties.ADM1_FR || properties.ADM1_EN || properties.admin1Name_fr || properties.admin1Name_en || properties.shapeName || properties.admin0Name_en || "";
}

function roadColor(type = "") {
  const colors = {
    trunk: "#f6a43a",
    primary: "#f4d35e",
    secondary: "#d7e87b",
    tertiary: "#b5c9a3",
  };
  return colors[String(type).toLowerCase()] || "#8ca1ad";
}

function roadWeight(type = "") {
  const weights = {
    trunk: 2.1,
    primary: 1.8,
    secondary: 1.35,
    tertiary: 1,
  };
  return weights[String(type).toLowerCase()] || 0.8;
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
