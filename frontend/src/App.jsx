import React, { Component, useEffect, useState, useCallback } from "react";
import LFIForm from "./components/LFIForm.jsx";
import PhotoIngest from "./components/PhotoIngest.jsx";
import MapView from "./components/MapView.jsx";
import Chronologie from "./components/Chronologie.jsx";
import Documents from "./components/Documents.jsx";
import FieldObjects from "./components/FieldObjects.jsx";
import Reference from "./components/Reference.jsx";
import { getDocuments, getFieldObjects, getLfi, getLinks, getPhotos, getPins, getStorageSize, health } from "./api";
import { DEFAULT_LANG, t } from "./i18n";
import { onGlobalRefresh } from "./utils/refreshBus";


class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, retryNonce: 0 };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("Tab render error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="card tab-error" role="alert">
          <h3>{this.props.title || "Tab failed to load"}</h3>
          <p>Try clicking Refresh. If the problem continues, restart Waypoint.</p>
          <button
            type="button"
            className="small-action"
            onClick={() => this.setState((state) => ({ hasError: false, error: null, retryNonce: state.retryNonce + 1 }))}
          >
            Try again
          </button>
        </div>
      );
    }
    return <React.Fragment key={this.state.retryNonce}>{this.props.children}</React.Fragment>;
  }
}

const BLANK_LFI_FORM = {
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

export default function App() {
  const [active, setActive] = useState("lfi"); // lfi | photos | map | documents | objects | chronologie | reference
  const [lfiList, setLfiList] = useState([]);
  const [lfiDraft, setLfiDraft] = useState(BLANK_LFI_FORM);
  const [lfiDraftRel, setLfiDraftRel] = useState("F");
  const [lfiEditingId, setLfiEditingId] = useState(null);
  const [photoList, setPhotoList] = useState([]);
  const [pinList, setPinList] = useState([]);
  const [documentList, setDocumentList] = useState([]);
  const [linkList, setLinkList] = useState([]);
  const [objectList, setObjectList] = useState([]);
  const [sysStatus, setSysStatus] = useState(() => t("app.status.init", DEFAULT_LANG));
  const [lang, setLang] = useState(DEFAULT_LANG);
  const [mapCoordsForLfi, setMapCoordsForLfi] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("waypoint-theme") || "dark");
  const [mapFocus, setMapFocus] = useState(null);
  const [sourceFocus, setSourceFocus] = useState(null);
  const [storageDisplay, setStorageDisplay] = useState(null);
  const [currentReportContext, setCurrentReportContext] = useState(null); // null = new/clean workspace for photos/docs
  const [lastRefresh, setLastRefresh] = useState(null);
  const [mapReloadToken, setMapReloadToken] = useState(0);
  const tt = (key, vars = {}) => t(key, lang, vars);

  const loadAll = useCallback(async () => {
    try {
      const [lfi, photos, pins, documents, links, objects, h, storage] = await Promise.all([
        getLfi(),
        getPhotos(),
        getPins(),
        getDocuments(),
        getLinks(),
        getFieldObjects(),
        health().catch(() => ({ status: "backend?" })),
        getStorageSize().catch(() => null),
      ]);
      setLfiList(lfi);
      setPhotoList(photos);
      setPinList(pins);
      setDocumentList(documents);
      setLinkList(links);
      setObjectList(objects);
      if (storage) setStorageDisplay(storage.display);
      setSysStatus(h.status === "ok" ? tt("app.status.backend_ok", {lfi: h.counts.lfi, photos: h.counts.photos, pins: h.counts.pins, documents: h.counts.documents || 0, objects: h.counts.objects || 0}) : tt("app.status.backend_error"));
    } catch (e) {
      setSysStatus(tt("app.status.load_error"));
    }
  }, [lang]);  // depend on lang so status uses correct lang; cheap for low-end

  useEffect(() => {
    loadAll();
    // periodic light refresh (low resource machines: every 25s is fine) - avoid frequent to save CPU/RAM
    const id = setInterval(() => { loadAll(); }, 25000);
    return () => clearInterval(id);
  }, [loadAll]);  // re-setup if loadAll changes (on lang)

  useEffect(() => {
    return onGlobalRefresh(async () => {
      await loadAll();
      setMapReloadToken((token) => token + 1);
      const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastRefresh(stamp);
    });
  }, [loadAll]);

  async function refreshAll() {
    await loadAll();
    setMapReloadToken((token) => token + 1);
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setLastRefresh(t);
  }

  function startNewReport() {
    // Per issue 1: reset draft, pin to general + yellow (unknown), clear editing, clean workspace (photos/docs), keep recent list
    setLfiDraft({
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
    });
    setLfiDraftRel("F");
    setLfiEditingId(null);
    setCurrentReportContext(null);
    setActive("lfi");
  }

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      localStorage.setItem("waypoint-theme", next);
      return next;
    });
  }

  function openSource(source, sourceId) {
    const normalized = source === "field_report" ? "lfi" : source;
    if (normalized === "photo") setActive("photos");
    if (normalized === "lfi") setActive("lfi");
    if (normalized === "document") setActive("documents");
    if (["person", "vehicle", "group", "location", "event"].includes(normalized)) setActive("objects");
    if (sourceId != null) {
      setSourceFocus({ source: normalized, id: String(sourceId), nonce: Date.now() });
    }
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <header>
        <div>
          <h1>{tt("app.title")}</h1>
          <div className="subtitle">{tt("app.subtitle")}</div>
        </div>
        <div className="header-status">
          {sysStatus}<br />
          <span style={{ opacity: 0.7 }}>{tt("app.flow")}</span>
          <div className="header-controls">
            <button type="button" className="theme-toggle" onClick={toggleTheme}>
              {theme === "dark" ? tt("theme.day") : tt("theme.night")}
            </button>
          </div>
        </div>
      </header>

      <div className="nav">
        <button className={active === "lfi" ? "active" : ""} onClick={() => setActive("lfi")}>
          {tt("nav.lfi")}
        </button>
        <button className={active === "photos" ? "active" : ""} onClick={() => setActive("photos")}>
          {tt("nav.photos")}
        </button>
        <button className={active === "map" ? "active" : ""} onClick={() => setActive("map")}>
          {tt("nav.map")}
        </button>
        <button className={active === "documents" ? "active" : ""} onClick={() => setActive("documents")}>
          {tt("nav.documents")}
        </button>
        <button className={active === "objects" ? "active" : ""} onClick={() => setActive("objects")}>
          {tt("nav.objects")}
        </button>
        <button className={active === "chronologie" ? "active" : ""} onClick={() => setActive("chronologie")}>
          {tt("nav.chronologie")}
        </button>
        <button className={active === "reference" ? "active" : ""} onClick={() => setActive("reference")}>
          {tt("nav.reference")}
        </button>
        <button onClick={refreshAll} className="refresh-nav" title={tt("refresh.tooltip") || "Reloads all data from the database."}>
          {tt("nav.refresh")}
        </button>
      </div>

      <div className="container">
        <div className="workflow-strip" aria-label={tt("workflow.title")}>
          <span className={active === "lfi" ? "active" : ""}>{tt("workflow.step1")}</span>
          <span className={["photos", "documents"].includes(active) ? "active" : ""}>{tt("workflow.step2")}</span>
          <span className={active === "map" ? "active" : ""}>{tt("workflow.step3")}</span>
          <span className={active === "chronologie" ? "active" : ""}>{tt("workflow.step4")}</span>
          <span className={active === "objects" ? "active" : ""}>{tt("workflow.step5")}</span>
        </div>

        {active === "lfi" && (
          <ErrorBoundary key="lfi" title="Field Reports failed to load">
          <LFIForm
            lang={lang}
            onSaved={refreshAll}
            recentLfi={lfiList}
            mapCoords={mapCoordsForLfi}
            onMapCoordsUsed={() => setMapCoordsForLfi(null)}
            focusedId={sourceFocus?.source === "lfi" ? sourceFocus : null}
            form={lfiDraft}
            setForm={setLfiDraft}
            selectedRel={lfiDraftRel}
            setSelectedRel={setLfiDraftRel}
            editingId={lfiEditingId}
            setEditingId={setLfiEditingId}
            currentReportContext={currentReportContext}
            onStartNewReport={startNewReport}
            onReportContextChange={setCurrentReportContext}
          />
          </ErrorBoundary>
        )}

        {active === "photos" && (
          <ErrorBoundary key="photos" title="Photos failed to load">
          <PhotoIngest
            lang={lang}
            onUploaded={refreshAll}
            photos={photoList}
            recentLfi={lfiList}
            links={linkList}
            currentReportContext={currentReportContext}
            focusedId={sourceFocus?.source === "photo" ? sourceFocus : null}
          />
          </ErrorBoundary>
        )}

        {active === "map" && (
          <ErrorBoundary key="map" title="Map failed to load">
          <MapView
            lang={lang}
            lfiList={lfiList}
            photoList={photoList}
            documentList={documentList}
            objectList={objectList}
            pinList={pinList}
            focusCoordinates={mapFocus}
            refreshAll={refreshAll}
            reloadToken={mapReloadToken}
            onUseCoordinates={(coords) => {
              setMapCoordsForLfi(coords);
              setActive("lfi");
            }}
            onOpenSource={openSource}
          />
          </ErrorBoundary>
        )}

        {active === "documents" && (
          <ErrorBoundary key="documents" title="Documents failed to load">
          <Documents
            lang={lang}
            documents={documentList}
            links={linkList}
            lfiList={lfiList}
            currentReportContext={currentReportContext}
            onUploaded={refreshAll}
            onPinCreated={refreshAll}
            focusedId={sourceFocus?.source === "document" ? sourceFocus : null}
          />
          </ErrorBoundary>
        )}

        {active === "objects" && (
          <ErrorBoundary key="objects" title="Field Objects failed to load">
          <FieldObjects
            lang={lang}
            objects={objectList}
            links={linkList}
            lfiList={lfiList}
            photoList={photoList}
            documents={documentList}
            focusedId={sourceFocus && ["person", "vehicle", "group", "location", "event"].includes(sourceFocus.source) ? sourceFocus : null}
            onCreated={refreshAll}
            onOpenSource={openSource}
            onShowOnMap={(coords) => {
              setMapFocus({ ...coords, nonce: Date.now() });
              setActive("map");
            }}
          />
          </ErrorBoundary>
        )}

        {active === "chronologie" && (
          <ErrorBoundary key="chronologie" title="Timeline failed to load">
          <Chronologie
            lang={lang}
            lfiList={lfiList}
            photoList={photoList}
            documentList={documentList}
            objectList={objectList}
          />
          </ErrorBoundary>
        )}

        {active === "reference" && (
          <ErrorBoundary key="reference" title="Reference failed to load">
            <Reference />
          </ErrorBoundary>
        )}

        {/* Always show a tiny combined status bar when not on map */}
        {active !== "map" && active !== "chronologie" && (
          <div className="card" style={{ padding: "10px 14px", fontSize: 13 }}>
            <strong>{tt("status.terrain")}</strong> {tt("status.lfi_count", {count: lfiList.length})} | {tt("status.photo_count", {count: photoList.length})} | {tt("status.doc_count", {count: documentList.length})} | {tt("status.object_count", {count: objectList.length})} | {tt("status.pin_count", {count: pinList.length})}.
            {tt("status.map_hint")}
            {storageDisplay != null && (
              <span style={{ marginLeft: 12, color: "var(--muted)", fontSize: 12 }}>
                {tt("status.storage", { size: storageDisplay })}
              </span>
            )}
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button onClick={refreshAll} className="small-action" title={tt("refresh.tooltip") || "Reloads all data from the database."}>{tt("status.refresh")}</button>
          {lastRefresh && (
            <span style={{ marginLeft: 8, fontSize: 12, color: "var(--muted)" }}>
              {tt("status.last_refresh", { time: lastRefresh })}
            </span>
          )}
        </div>
      </div>

      <footer>
        {tt("footer")}
      </footer>
    </div>
  );
}

