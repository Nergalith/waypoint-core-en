import React, { useMemo, useState } from "react";
import { t, translateReportType } from "../i18n";

export default function Chronologie({ lang = "fr", lfiList, photoList, documentList, objectList = [] }) {
  const tt = (key, vars = {}) => t(key, lang, vars);

  // Memoize the merged timeline computation (avoids rebuild on every render, low CPU/mem on old hardware)
  const events = useMemo(() => {
    const evs = [];

    (lfiList || []).forEach((l) => {
      evs.push({
        id: `lfi-${l.id}`,
        type: "lfi",
        time: l.when_happened || l.created_at,
        created_at: l.created_at,
        summary: `${translateReportType(l.report_type, tt)}: ${l.what_happened?.slice(0, 80) || l.who_involved?.slice(0, 60) || tt("chrono.no_detail")}`,
        location: l.where_happened,
        reliability: l.source_reliability,
        related_to: l.related_to || "",
        has_geo: !!(l.latitude && l.longitude),
        raw: l,
      });
    });

    (photoList || []).forEach((p) => {
      evs.push({
        id: `photo-${p.id}`,
        type: "photo",
        time: p.datetime_original || p.created_at,
        created_at: p.created_at,
        summary: `${tt("chrono.photo")} ${p.original_filename}`,
        location: (p.latitude && p.longitude) ? `${Number(p.latitude).toFixed(4)}, ${Number(p.longitude).toFixed(4)}` : "",
        reliability: null,
        related_to: p.related_to || "",
        has_geo: !!(p.latitude && p.longitude),
        raw: p,
      });
    });

    (documentList || []).forEach((d) => {
      const clues = d.clues || {};
      const dates = clues.dates || [];
      evs.push({
        id: `document-${d.id}`,
        type: "document",
        time: dates[0] || d.uploaded_at,
        created_at: d.uploaded_at,
        summary: `${tt("chrono.document")} ${d.original_filename}`,
        location: (clues.coordinates || []).slice(0, 1).map((c) => `${Number(c.latitude).toFixed(4)}, ${Number(c.longitude).toFixed(4)}`).join(""),
        reliability: null,
        related_to: d.related_to || "",
        has_geo: (clues.coordinates || []).length > 0,
        raw: d,
      });
    });

    (objectList || []).filter((item) => item.object_type === "event").forEach((item) => {
      evs.push({
        id: `object-${item.id}`,
        type: "event",
        time: item.updated_at || item.created_at,
        created_at: item.updated_at || item.created_at,
        summary: `${tt("chrono.event")} ${item.name}`,
        location: (item.latitude != null && item.longitude != null) ? `${Number(item.latitude).toFixed(4)}, ${Number(item.longitude).toFixed(4)}` : "",
        reliability: null,
        related_to: item.description || "",
        has_geo: !!(item.latitude != null && item.longitude != null),
        raw: item,
      });
    });

    // Sort by created_at desc. Simple string compare, no Date parse (CPU save).
    evs.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

    return evs;
  }, [lfiList, photoList, documentList, objectList, lang]);  // deps for memo opt + lang for tt in summaries

  // Report generation state & logic - on-demand only (lightweight, no precompute for low-end perf)
  const [reportTitle, setReportTitle] = useState('');
  const [reportContent, setReportContent] = useState('');
  const [showReport, setShowReport] = useState(false);

  const generateReport = (type) => {
    const recentLfis = (lfiList || []).slice(0, 7);
    const recentPhotos = (photoList || []).slice(0, 5);
    const recentDocs = (documentList || []).slice(0, 5);
    const date = new Date().toISOString().slice(0,10);
    let title = tt(`reports.${type}_title`);
    let contentLines = [];
    contentLines.push(tt('reports.date', {date}));
    const area = recentLfis[0]?.where_happened || recentPhotos[0]?.location || tt("common.na");
    contentLines.push(tt('reports.area', {area}));
    contentLines.push('');
    contentLines.push(tt('reports.observations'));
    if (recentLfis.length === 0) {
      contentLines.push(tt('reports.no_data'));
    } else {
      recentLfis.forEach(l => {
        const line = `- ${l.when_happened || l.created_at} | ${l.who_involved || tt("common.none")} : ${(l.what_happened || "").slice(0,50)} @ ${l.where_happened || tt("common.none")} (${tt("reports.reliability_short")}: ${l.source_reliability})${l.related_to ? ` | ${tt("common.linked", { note: l.related_to })}` : ""}`;
        contentLines.push(line);
      });
    }
    if (recentPhotos.length > 0) {
      contentLines.push('');
      contentLines.push(tt('reports.photos'));
      recentPhotos.forEach(p => {
        const loc = p.latitude ? `${Number(p.latitude).toFixed(2)},${Number(p.longitude).toFixed(2)}` : "";
        const line = `- ${p.datetime_original || p.created_at} | ${p.original_filename} ${loc ? `@ ${loc}` : ""}${p.related_to ? ` | ${tt("common.linked", { note: p.related_to })}` : ""}`;
        contentLines.push(line);
      });
    }
    if (recentDocs.length > 0) {
      contentLines.push('');
      contentLines.push(tt('reports.documents'));
      recentDocs.forEach(d => {
        const coords = (d.clues?.coordinates || []).slice(0, 1).map(c => `${Number(c.latitude).toFixed(2)},${Number(c.longitude).toFixed(2)}`).join("");
        const status = tt(`docs.status.${d.extraction_status}`);
        const line = `- ${d.uploaded_at} | ${d.original_filename} (${status})${coords ? ` @ ${coords}` : ""}${d.related_to ? ` | ${tt("common.linked", { note: d.related_to })}` : ""}`;
        contentLines.push(line);
      });
    }
    setReportTitle(title);
    setReportContent(contentLines.join('\n'));
    setShowReport(true);
  };

  const copyReport = () => {
    if (reportContent) {
      navigator.clipboard?.writeText(reportContent).catch(() => {});
    }
  };

  const downloadReport = () => {
    if (!reportContent) return;
    const blob = new Blob([reportContent], {type: 'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(reportTitle || 'report').replace(/ /g,'_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const closeReport = () => {
    setShowReport(false);
    setReportContent('');
    setReportTitle('');
  };

  return (
    <div className="card">
      <h2>{tt("chrono.title")}</h2>

      <div className="tooltip" style={{ background: 'rgba(246, 164, 58, 0.12)', padding: '8px', marginBottom: '12px', borderRadius: '4px', borderColor: 'rgba(246, 164, 58, 0.35)' }}>
        {tt("chrono.edu")}
      </div>

      {events.length === 0 && (
        <div className="empty-state">{tt("chrono.empty")}</div>
      )}

      {events.length > 0 && (
        <div>
          {events.map((ev, idx) => (
            <div key={ev.id} className="list-item" style={{ borderLeft: '4px solid ' + (ev.type === 'lfi' ? 'var(--accent-strong)' : 'var(--accent)'), paddingLeft: '10px', marginBottom: '8px' }}>
              <div style={{ minWidth: '140px', fontSize: '12px', color: 'var(--muted)' }}>
                {ev.time || ev.created_at}
              </div>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600 }}>
                  {eventTypeLabel(ev.type, tt)}
                </span>
                {" — "}
                {ev.summary}
                {ev.location && <span style={{ color: 'var(--soft)' }}> @ {ev.location}</span>}
                {ev.reliability && (
                  <span className="pill" style={{ background: ev.reliability === 'A' || ev.reliability === 'B' ? '#16a34a' : (ev.reliability === 'C' ? '#eab308' : '#6b7280'), marginLeft: '6px' }}>
                    {ev.reliability}
                  </span>
                )}
                {ev.has_geo && <span style={{ marginLeft: '4px' }}>📍</span>}
                {ev.related_to && (
                  <div style={{ fontSize: '12px', color: 'var(--accent)', marginTop: '2px' }}>
                    <strong>{tt("chrono.linked", {note: ev.related_to})}</strong>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '8px' }}>
            {tt("chrono.count", {count: events.length})}
          </div>
        </div>
      )}

      {/* One-Click Report Generation - basic, bilingual, on-demand for low perf impact */}
      <div style={{marginTop: '16px', paddingTop: '8px', borderTop: '1px solid var(--border)'}}>
        <strong>{tt('reports.title')}</strong>
        <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '6px 0'}}>
          <button title={tt('reports.patrol')} onClick={() => generateReport('patrol')} style={{padding: '6px 10px', fontSize: '13px', background: 'rgba(66, 200, 255, 0.12)', color: 'var(--text)', border: '1px solid var(--accent)', borderRadius: '4px', cursor: 'pointer'}}>{tt('reports.patrol')}</button>
          <button title={tt('reports.incident')} onClick={() => generateReport('incident')} style={{padding: '6px 10px', fontSize: '13px', background: 'rgba(246, 164, 58, 0.12)', color: 'var(--text)', border: '1px solid var(--warning)', borderRadius: '4px', cursor: 'pointer'}}>{tt('reports.incident')}</button>
          <button title={tt('reports.weekly')} onClick={() => generateReport('weekly')} style={{padding: '6px 10px', fontSize: '13px', background: 'rgba(74, 144, 255, 0.14)', color: 'var(--text)', border: '1px solid #4a90ff', borderRadius: '4px', cursor: 'pointer'}}>{tt('reports.weekly')}</button>
        </div>
        {showReport && reportContent && (
          <div style={{marginTop: '8px', padding: '8px', background: 'var(--card-strong)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap', maxHeight: '300px', overflow: 'auto'}}>
            <div style={{fontWeight: 'bold', marginBottom: '4px'}}>{reportTitle}</div>
            {reportContent}
            <div style={{marginTop: '8px', display: 'flex', gap: '6px'}}>
              <button title={tt('reports.copy')} onClick={copyReport} style={{padding: '4px 8px', fontSize: '11px'}}>{tt('reports.copy')}</button>
              <button title={tt('reports.download')} onClick={downloadReport} style={{padding: '4px 8px', fontSize: '11px'}}>{tt('reports.download')}</button>
              <button title={tt('reports.close')} onClick={closeReport} style={{padding: '4px 8px', fontSize: '11px'}}>{tt('reports.close')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function eventTypeLabel(type, tt) {
  if (type === "lfi") return tt("chrono.lfi");
  if (type === "photo") return tt("chrono.photo");
  if (type === "event") return tt("chrono.event");
  return tt("chrono.document");
}

