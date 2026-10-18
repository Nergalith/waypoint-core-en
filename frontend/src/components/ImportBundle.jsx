import { useState } from "react";
import { importBundle } from "../api";
import { triggerGlobalRefresh } from "../utils/refreshBus";

function resultFormat(data, tt) {
  if (!data) return tt("import.result_default");
  if (data.imported === "FIELD_NODE") return tt("import.format_field_node");
  if (data.imported === "WAYFINDER" || data.callsigns) return tt("import.format_wayfinder");
  return String(data.imported || tt("import.result_default"));
}

export default function ImportBundle({ onImportComplete, tt }) {
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => file.name.toLowerCase().endsWith(".zip"));
    if (files.length === 0) {
      setError(tt("import.zip_only"));
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
        nextResults.push({ file: file.name, ok: false, error: err.message || tt("import.failed") });
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
        {tt("import.button")}
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
            <p>{tt("import.importing")}</p>
          ) : (
            <>
              <p className="import-title">{tt("import.drop")}</p>
              <p className="import-sub">
                {tt("import.help")}
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
                <strong>{result.file}</strong> - {resultFormat(result.data, tt)}
                {result.data?.skipped && (
                  <span>{" "}- {tt("import.already_imported")}</span>
                )}
                {!result.data?.skipped && result.data?.waypoint_report_number && (
                  <span>
                    {" "}- {tt("import.field_node_result", {
                      report: result.data.waypoint_report_number,
                      photos: result.data.photos_saved || 0,
                      pin: result.data.pin_created ? tt("import.pin_created") : tt("import.pin_not_created"),
                    })}
                  </span>
                )}
                {result.data?.callsigns && (
                  <span>{" "}- {tt("import.tracks", { callsigns: result.data.callsigns.join(", ") })}</span>
                )}
              </>
            ) : (
              <><strong>{result.file}</strong> - {tt("import.failed_detail", { message: result.error })}</>
            )}
          </div>
        ))}

        <div className="import-actions">
          <button type="button" className="small-action" onClick={close}>{tt("import.close")}</button>
        </div>
      </div>
    </div>
  );
}
