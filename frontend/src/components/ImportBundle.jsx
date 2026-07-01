import { useState } from "react";
import { importBundle } from "../api";
import { triggerGlobalRefresh } from "../utils/refreshBus";

const FORMAT_LABELS = {
  FIELD_NODE: "Field Node Report",
  WAYFINDER: "Wayfinder Patrol Track",
  AAR: "Wayfinder Patrol Track",
};

function resultFormat(data) {
  if (!data) return "Import";
  if (data.imported === "FIELD_NODE") return FORMAT_LABELS.FIELD_NODE;
  if (data.imported === "WAYFINDER") return FORMAT_LABELS.WAYFINDER;
  if (data.callsigns) return FORMAT_LABELS.AAR;
  return FORMAT_LABELS[data.imported] || String(data.imported || "Import");
}

export default function ImportBundle({ onImportComplete }) {
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => file.name.toLowerCase().endsWith(".zip"));
    if (files.length === 0) {
      setError("Drop ZIP files only (.zip)");
      return;
    }

    setLoading(true);
    setResults(null);
    setError(null);

    const nextResults = [];
    for (const file of files) {
      try {
        const data = await importBundle(file);
        nextResults.push({ file: file.name, ok: true, data });
      } catch (err) {
        nextResults.push({ file: file.name, ok: false, error: err.message || "Import failed" });
      }
    }

    setLoading(false);
    setResults(nextResults);
    if (nextResults.some((item) => item.ok)) {
      triggerGlobalRefresh();
      if (onImportComplete) await onImportComplete();
    }
  }

  function close() {
    setActive(false);
    setResults(null);
    setError(null);
    setLoading(false);
  }

  if (!active) {
    return (
      <button type="button" className="small-action btn-import" onClick={() => setActive(true)}>
        Import Bundle
      </button>
    );
  }

  return (
    <div className="import-overlay">
      <div className="import-card">
        <div
          className={`import-dropzone ${loading ? "loading" : ""}`}
          onDrop={(e) => {
            e.preventDefault();
            handleFiles(e.dataTransfer.files);
          }}
          onDragOver={(e) => e.preventDefault()}
        >
          {loading ? (
            <p>Importing...</p>
          ) : (
            <>
              <p className="import-title">Drop ZIP bundles here</p>
              <p className="import-sub">
                Field Node reports and Wayfinder tracks are detected automatically. Multiple ZIPs are OK.
              </p>
              <input
                type="file"
                accept=".zip"
                multiple
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </div>

        {error && <div className="import-status error">{error}</div>}

        {results && results.map((result, index) => (
          <div key={`${result.file}-${index}`} className={`import-status ${result.ok ? "ok" : "error"}`}>
            {result.ok ? (
              <>
                <strong>{result.file}</strong> - {resultFormat(result.data)}
                {result.data?.skipped && (
                  <span>{" "}- {result.data.reason || "already imported - skipped"}</span>
                )}
                {!result.data?.skipped && result.data?.waypoint_report_number && (
                  <span>
                    {" "}- {result.data.waypoint_report_number}, {result.data.photos_saved || 0} photo(s), pin {result.data.pin_created ? "created" : "not created (no GPS)"}
                  </span>
                )}
                {result.data?.callsigns && (
                  <span>{" "}- Tracks: {result.data.callsigns.join(", ")}</span>
                )}
              </>
            ) : (
              <><strong>{result.file}</strong> - Failed: {result.error}</>
            )}
          </div>
        ))}

        <div className="import-actions">
          <button type="button" className="small-action" onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}
