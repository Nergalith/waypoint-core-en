import React, { useMemo, useState } from "react";
import { createLink, clearAllData } from "../api";
import { t } from "../i18n";

const OBJECT_TYPES = [
  "field_report",
  "photo",
  "document",
  "person",
  "vehicle",
  "group",
  "location",
  "event",
];

const RELATIONSHIPS = [
  "related_to",
  "observed_at",
  "mentioned_in",
  "photographed_at",
  "reported_by",
  "associated_with",
  "same_as",
];

const TYPE_STYLES = {
  field_report: { color: "#29d37d" },
  photo: { color: "#8b5cf6" },
  document: { color: "#9ca3af" },
  person: { color: "#42c8ff" },
  vehicle: { color: "#f6a43a" },
  group: { color: "#ff8f70" },
  location: { color: "#fb923c" },
  event: { color: "#ff5a4f" },
};

export default function Connections({
  lang = "en",
  links = [],
  lfiList = [],
  photoList = [],
  documents = [],
  fieldObjects = [],
  pins = [],
  onCreated,
  onOpenSource,
  onShowOnMap,
}) {
  const tt = (key, vars = {}) => t(key, lang, vars);
  const options = useMemo(() => buildObjectOptions(lfiList, photoList, documents, fieldObjects, tt), [lfiList, photoList, documents, fieldObjects, lang]);
  const graph = useMemo(() => buildGraph(links, lfiList, photoList, documents, fieldObjects, pins, tt), [links, lfiList, photoList, documents, fieldObjects, pins, lang]);
  const [form, setForm] = useState({
    source_type: "field_report",
    source_id: "",
    source_label: "",
    relationship_type: "related_to",
    target_type: "document",
    target_id: "",
    target_label: "",
    notes: "",
  });
  const [status, setStatus] = useState("");
  const [selection, setSelection] = useState(null);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function selectObject(side, value) {
    if (value === "__manual__") {
      update(`${side}_id`, "");
      update(`${side}_label`, "");
      return;
    }
    const item = options.find((opt) => opt.value === value);
    if (!item) return;
    setForm((f) => ({
      ...f,
      [`${side}_type`]: item.type,
      [`${side}_id`]: item.id,
      [`${side}_label`]: item.label,
    }));
  }

  async function submit(e) {
    e.preventDefault();
    setStatus("");
    if (!form.source_label.trim() || !form.target_label.trim()) {
      setStatus(tt("links.label_required"));
      return;
    }
    try {
      await createLink(form);
      setStatus(tt("links.created"));
      setForm((f) => ({ ...f, source_id: "", source_label: "", target_id: "", target_label: "", notes: "" }));
      if (onCreated) await onCreated();
    } catch {
      setStatus(tt("links.error"));
    }
  }

  function openSource(node) {
    if (onOpenSource && canOpenSource(node)) onOpenSource(node.type, node.sourceId);
  }

  function showOnMap(node) {
    if (onShowOnMap && node.coordinates) onShowOnMap(node.coordinates);
  }

  return (
    <div className="card">
      <h2>{tt("links.title")}</h2>
      <p style={{ color: "var(--soft)" }}>{tt("links.intro")}</p>
      {status && <div className="status">{status}</div>}

      <div className="graph-summary">
        <span><strong>{graph.nodes.length}</strong> {tt("links.summary_nodes")}</span>
        <span><strong>{links.length}</strong> {tt("links.summary_links")}</span>
        <span>{tt("links.summary_most_connected")}: <strong>{graph.mostConnected?.label || tt("links.summary_none")}</strong></span>
        <span>{tt("links.summary_isolated")}: <strong>{graph.isolatedCount}</strong></span>
      </div>

      <div className="graph-workspace graph-workspace-wide">
        <RelationshipGraph
          tt={tt}
          graph={graph}
          selected={selection}
          onSelect={setSelection}
        />
        <div className="graph-details link-side-panel">
          <SelectionPanel
            tt={tt}
            selection={selection}
            onOpenSource={openSource}
            onShowOnMap={showOnMap}
          />
          <LinkForm
            tt={tt}
            form={form}
            update={update}
            submit={submit}
            selectObject={selectObject}
            options={options}
          />
        </div>
      </div>

      <div className="link-list">
        {links.length === 0 && <div className="empty-state">{tt("links.empty")}</div>}
        {links.map((link) => {
          const sourceLabel = graph.nodeByKey.get(objectKey(link.source_type, link.source_id, link.source_label))?.label || link.source_label;
          const targetLabel = graph.nodeByKey.get(objectKey(link.target_type, link.target_id, link.target_label))?.label || link.target_label;
          return (
            <div key={link.id} className="link-row">
              <span className="object-pill">{labelObjectType(link.source_type, tt)}</span>
              <strong>{sourceLabel}</strong>
              <span className="relationship-pill">{relationshipLabel(link.relationship_type, tt)}</span>
              <span className="object-pill">{labelObjectType(link.target_type, tt)}</span>
              <strong>{targetLabel}</strong>
              {link.notes && <span className="link-note">{link.notes}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RelationshipGraph({ tt, graph, selected, onSelect }) {
  if (graph.nodes.length === 0) {
    return <div className="graph-empty">{tt("links.graph_empty")}</div>;
  }

  return (
    <div className="graph-panel" aria-label={tt("links.graph_title")}>
      <div className="graph-title">{tt("links.graph_title")}</div>
      <svg className="relationship-graph" viewBox="0 0 1120 620" role="img">
        {graph.edges.map((edge) => {
          const source = graph.nodeByKey.get(edge.sourceKey);
          const target = graph.nodeByKey.get(edge.targetKey);
          if (!source || !target) return null;
          const selectedEdge = selected?.kind === "edge" && selected.item.id === edge.id;
          const showEdgeLabel = selectedEdge || graph.edges.length <= 6;
          return (
            <g key={edge.id}>
              <line
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                className={selectedEdge ? "graph-edge selected" : "graph-edge"}
                onClick={() => onSelect({ kind: "edge", item: edge })}
              />
              {showEdgeLabel && (
                <text
                  x={(source.x + target.x) / 2}
                  y={(source.y + target.y) / 2 - 10}
                  className="graph-edge-label"
                  onClick={() => onSelect({ kind: "edge", item: edge })}
                >
                  {shorten(relationshipLabel(edge.relationship, tt), 22)}
                </text>
              )}
            </g>
          );
        })}

        {graph.nodes.map((node) => {
          const style = TYPE_STYLES[node.type] || TYPE_STYLES.event;
          const selectedNode = selected?.kind === "node" && selected.item.key === node.key;
          return (
            <g
              key={node.key}
              className={selectedNode ? "graph-node selected" : "graph-node"}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={() => onSelect({ kind: "node", item: node })}
            >
              <circle r={Math.min(34, 22 + node.degree * 3)} fill={style.color} />
              <text y="-2" className="graph-node-badge">{tt(`object.${node.type}_badge`)}</text>
              <text y={node.labelY} className="graph-node-label">{shorten(node.label, 25)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SelectionPanel({ tt, selection, onOpenSource, onShowOnMap }) {
  if (!selection) {
    return (
      <div className="selection-details">
        <h3>{tt("links.details_title")}</h3>
        <p>{tt("links.details_empty")}</p>
      </div>
    );
  }

  if (selection.kind === "edge") {
    const edge = selection.item;
    return (
      <div className="selection-details">
        <h3>{tt("links.edge_title")}</h3>
        <div className="detail-line"><strong>{tt("links.relationship")}:</strong> {relationshipLabel(edge.relationship, tt)}</div>
        <div className="detail-line"><strong>{tt("links.source")}:</strong> {edge.sourceLabel}</div>
        <div className="detail-line"><strong>{tt("links.target")}:</strong> {edge.targetLabel}</div>
        {edge.notes && <div className="detail-note">{edge.notes}</div>}
      </div>
    );
  }

  const node = selection.item;
  return (
    <div className="selection-details">
      <h3>{tt("links.node_title")}</h3>
      <span className="object-pill">{labelObjectType(node.type, tt)}</span>
      <div className="detail-line"><strong>{node.label}</strong></div>
      <div className="detail-line">{tt("links.node_degree", { count: node.degree })}</div>
      {node.coordinates && (
        <div className="detail-line">
          {Number(node.coordinates.latitude).toFixed(5)}, {Number(node.coordinates.longitude).toFixed(5)}
        </div>
      )}
      <div className="detail-actions">
        {canOpenSource(node) && <button className="small-action" title={tt("links.open_source")} onClick={() => onOpenSource(node)}>{tt("links.open_source")}</button>}
        {node.coordinates && <button className="small-action" title={tt("links.show_on_map")} onClick={() => onShowOnMap(node)}>{tt("links.show_on_map")}</button>}
      </div>
    </div>
  );
}


function LinkForm({ tt, form, update, submit, selectObject, options }) {
  return (
    <form onSubmit={submit} className="link-form link-form-compact">
      <ObjectPicker side="source" title={tt("links.source")} tt={tt} form={form} update={update} selectObject={selectObject} options={options} />
      <div>
        <label>{tt("links.relationship")}</label>
        <select value={form.relationship_type} onChange={(e) => update("relationship_type", e.target.value)}>
          {RELATIONSHIPS.map((value) => <option key={value} value={value}>{relationshipLabel(value, tt)}</option>)}
        </select>
      </div>
      <ObjectPicker side="target" title={tt("links.target")} tt={tt} form={form} update={update} selectObject={selectObject} options={options} />
      <div className="link-notes">
        <label>{tt("links.notes")}</label>
        <input value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder={tt("links.notes_placeholder")} />
      </div>
      <button className="big-button" type="submit" title={tt("links.create")}>{tt("links.create")}</button>
    </form>
  );
}

function ObjectPicker({ side, title, tt, form, update, selectObject, options }) {
  const typeField = `${side}_type`;
  const idField = `${side}_id`;
  const labelField = `${side}_label`;
  const type = form[typeField];
  const typedOptions = options.filter((opt) => opt.type === type);

  return (
    <div className="object-picker">
      <label>{title}</label>
      <select value={type} onChange={(e) => update(typeField, e.target.value)}>
        {OBJECT_TYPES.map((value) => <option key={value} value={value}>{labelObjectType(value, tt)}</option>)}
      </select>
      <select value={form[idField] ? `${type}:${form[idField]}` : "__manual__"} onChange={(e) => selectObject(side, e.target.value)}>
        <option value="__manual__">{tt("links.manual_label")}</option>
        {typedOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
      <input value={form[labelField]} onChange={(e) => update(labelField, e.target.value)} placeholder={tt("links.label_placeholder")} />
    </div>
  );
}

function buildObjectOptions(lfiList, photoList, documents, fieldObjects, tt) {
  return [
    ...(lfiList || []).map((l) => ({
      type: "field_report",
      id: String(l.id),
      value: `field_report:${l.id}`,
      label: tt("object.field_report_label", { id: l.id, text: l.what_happened || l.who_involved || tt("lfi.no_detail") }),
    })),
    ...(photoList || []).map((p) => ({
      type: "photo",
      id: String(p.id),
      value: `photo:${p.id}`,
      label: tt("object.photo_label", { id: p.id, text: p.original_filename }),
    })),
    ...(documents || []).map((d) => ({
      type: "document",
      id: String(d.id),
      value: `document:${d.id}`,
      label: tt("object.document_label", { id: d.id, text: d.original_filename }),
    })),
    ...(fieldObjects || []).map((item) => ({
      type: item.object_type,
      id: String(item.id),
      value: `${item.object_type}:${item.id}`,
      label: tt("object.field_object_label", { id: item.id, text: item.name }),
    })),
  ];
}

function buildGraph(links, lfiList, photoList, documents, fieldObjects, pins, tt) {
  const metadata = buildMetadata(lfiList, photoList, documents, fieldObjects, pins, tt);
  const nodeByKey = new Map();
  const edges = [];

  (links || []).forEach((link) => {
    const sourceKey = objectKey(link.source_type, link.source_id, link.source_label);
    const targetKey = objectKey(link.target_type, link.target_id, link.target_label);
    const source = ensureNode(nodeByKey, metadata, sourceKey, link.source_type, link.source_id, link.source_label);
    const target = ensureNode(nodeByKey, metadata, targetKey, link.target_type, link.target_id, link.target_label);
    source.degree += 1;
    target.degree += 1;
    edges.push({
      id: link.id,
      sourceKey,
      targetKey,
      sourceLabel: source.label,
      targetLabel: target.label,
      relationship: normalizeRelationship(link.relationship_type),
      notes: link.notes,
    });
  });

  const nodes = layoutNodes(Array.from(nodeByKey.values()));
  const knownSourceKeys = new Set(metadata.keys());
  const linkedSourceKeys = new Set(nodes.filter((node) => knownSourceKeys.has(node.key)).map((node) => node.key));
  const isolatedCount = Array.from(knownSourceKeys).filter((key) => !linkedSourceKeys.has(key)).length;
  const mostConnected = nodes.reduce((best, node) => (!best || node.degree > best.degree ? node : best), null);

  return { nodes, edges, nodeByKey, mostConnected, isolatedCount };
}

function buildMetadata(lfiList, photoList, documents, fieldObjects, pins, tt) {
  const metadata = new Map();
  const documentPins = new Map();
  (pins || []).forEach((pin) => {
    if (pin.source === "document" && pin.source_id != null) {
      documentPins.set(String(pin.source_id), { latitude: pin.latitude, longitude: pin.longitude });
    }
  });

  (lfiList || []).forEach((lfi) => {
    metadata.set(`field_report:${lfi.id}`, {
      label: tt("object.field_report_label", { id: lfi.id, text: lfi.what_happened || lfi.who_involved || tt("lfi.no_detail") }),
      coordinates: coordinatePair(lfi.latitude, lfi.longitude),
      sourceId: lfi.id,
    });
  });
  (photoList || []).forEach((photo) => {
    metadata.set(`photo:${photo.id}`, {
      label: tt("object.photo_label", { id: photo.id, text: photo.original_filename }),
      coordinates: coordinatePair(photo.latitude, photo.longitude),
      sourceId: photo.id,
    });
  });
  (documents || []).forEach((doc) => {
    metadata.set(`document:${doc.id}`, {
      label: tt("object.document_label", { id: doc.id, text: doc.original_filename }),
      coordinates: documentPins.get(String(doc.id)),
      sourceId: doc.id,
    });
  });
  (fieldObjects || []).forEach((item) => {
    metadata.set(`${item.object_type}:${item.id}`, {
      label: tt("object.field_object_label", { id: item.id, text: item.name }),
      coordinates: coordinatePair(item.latitude, item.longitude),
      sourceId: item.id,
    });
  });
  return metadata;
}

function ensureNode(nodeByKey, metadata, key, type, id, fallbackLabel) {
  if (!nodeByKey.has(key)) {
    const known = metadata.get(key);
    nodeByKey.set(key, {
      key,
      type,
      sourceId: known?.sourceId || id,
      label: known?.label || fallbackLabel || labelObjectType(type, (key) => key),
      coordinates: known?.coordinates || null,
      degree: 0,
      x: 0,
      y: 0,
    });
  }
  return nodeByKey.get(key);
}

function layoutNodes(nodes) {
  if (nodes.length === 1) {
    return [{ ...nodes[0], x: 560, y: 300, labelY: 42 }];
  }
  const centerX = 560;
  const centerY = 300;
  const radiusX = nodes.length > 8 ? 455 : 365;
  const radiusY = nodes.length > 8 ? 235 : 195;
  return nodes
    .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
    .map((node, index) => {
      const angle = (Math.PI * 2 * index) / nodes.length - Math.PI / 2;
      const lowerHalf = Math.sin(angle) > 0.25;
      return {
        ...node,
        x: Math.round(centerX + Math.cos(angle) * radiusX),
        y: Math.round(centerY + Math.sin(angle) * radiusY),
        labelY: lowerHalf ? -32 : 42,
      };
    });
}

function objectKey(type, id, label) {
  const cleanType = type || "event";
  if (id) return `${cleanType}:${id}`;
  return `${cleanType}:manual:${String(label || "").trim().toLowerCase()}`;
}

function coordinatePair(latitude, longitude) {
  if (latitude == null || longitude == null) return null;
  return { latitude: Number(latitude), longitude: Number(longitude) };
}

function canOpenSource(node) {
  return ["field_report", "photo", "document", "person", "vehicle", "group", "location", "event"].includes(node.type) && node.sourceId;
}

function shorten(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function labelObjectType(value, tt) {
  return tt(`object.${value}`);
}

function relationshipLabel(value, tt) {
  return tt(`relationship.${normalizeRelationship(value)}`);
}

function normalizeRelationship(value) {
  if (RELATIONSHIPS.includes(value)) return value;
  const clean = String(value || "").toLowerCase().replace(/\s*\/\s*/g, " ").replace(/\s+/g, "_");
  if (clean === "same_as_possible_match") return "same_as";
  return RELATIONSHIPS.includes(clean) ? clean : "related_to";
}

