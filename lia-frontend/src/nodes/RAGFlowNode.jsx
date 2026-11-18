/**
 * NODE: RAGFlowNode - document knowledge base management panel.
 * Requires RAGFlow running at port 9380.
 */
import { useEffect, useRef, useState } from "react";

export default function RAGFlowNode() {
  const [up, setUp] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [newDataset, setNewDataset] = useState("");
  const [selectedDataset, setSelectedDataset] = useState("");
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [queryResult, setQueryResult] = useState("");
  const [querying, setQuerying] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);

  async function refresh() {
    try {
      const d = await fetch("/api/rag/status").then(r => r.json());
      setUp(d.up);
      setDatasets(d.datasets || []);
      if (!selectedDataset && d.datasets?.length) {
        setSelectedDataset(d.datasets[0].id);
      }
    } catch {}
  }

  async function createDataset() {
    if (!newDataset.trim() || creating) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/rag/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newDataset.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Failed");
      setNewDataset("");
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0];
    if (!file || !selectedDataset) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("dataset_id", selectedDataset);
      const res = await fetch("/api/rag/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json()).detail || "Upload failed");
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function runQuery() {
    if (!query.trim() || querying) return;
    setQuerying(true);
    setQueryResult("");
    setError("");
    try {
      const res = await fetch("/api/rag/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      const d = await res.json();
      setQueryResult(d.context || "(no results)");
    } catch (e) {
      setError(e.message);
    } finally {
      setQuerying(false);
    }
  }

  async function saveApiKey() {
    if (savingKey) return;
    setSavingKey(true);
    try {
      await fetch("/api/rag/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey }),
      });
      await refresh();
    } catch {}
    setSavingKey(false);
  }

  const statusColor = up === null ? "#9ca3af" : up ? "#4ade80" : "#f87171";
  const statusLabel = up === null ? "checking..." : up ? "online" : "offline";

  return (
    <div className="ragflow-node">
      <div className="ragflow-header">
        <span className="panel-label">RAGFlow</span>
        <span style={{ fontSize: 11, color: statusColor, marginLeft: 8 }}>{statusLabel}</span>
      </div>

      {!up && (
        <p style={{ fontSize: 11, color: "#9ca3af", margin: "6px 0" }}>
          Start RAGFlow: <code>docker compose up -f docker/docker-compose.yml</code> on port 9380.
        </p>
      )}

      {up && (
        <>
          {/* API key */}
          <div className="ragflow-row">
            <input
              className="ragflow-input"
              type="password"
              placeholder="RAGFlow API key (optional)"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
            />
            <button className="ragflow-btn" onClick={saveApiKey} disabled={savingKey}>
              {savingKey ? "..." : "Save"}
            </button>
          </div>

          {/* Dataset list */}
          <div className="ragflow-section-label">Knowledge bases</div>
          {datasets.length === 0 && (
            <p style={{ fontSize: 11, color: "#9ca3af" }}>No datasets yet.</p>
          )}
          {datasets.map(ds => (
            <div
              key={ds.id}
              className={`ragflow-dataset-row ${selectedDataset === ds.id ? "active" : ""}`}
              onClick={() => setSelectedDataset(ds.id)}
            >
              <span>{ds.name}</span>
              <span style={{ fontSize: 10, color: "#6b7280" }}>{ds.document_count ?? 0} docs</span>
            </div>
          ))}

          {/* Create dataset */}
          <div className="ragflow-row" style={{ marginTop: 8 }}>
            <input
              className="ragflow-input"
              placeholder="New knowledge base name"
              value={newDataset}
              onChange={e => setNewDataset(e.target.value)}
              onKeyDown={e => e.key === "Enter" && createDataset()}
            />
            <button className="ragflow-btn" onClick={createDataset} disabled={creating || !newDataset.trim()}>
              {creating ? "..." : "+"}
            </button>
          </div>

          {/* Upload */}
          <div className="ragflow-section-label" style={{ marginTop: 10 }}>Upload document</div>
          {!selectedDataset && (
            <p style={{ fontSize: 11, color: "#fbbf24" }}>Select or create a knowledge base first.</p>
          )}
          {selectedDataset && (
            <div className="ragflow-row">
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.txt,.docx,.md,.csv"
                onChange={uploadFile}
                disabled={uploading}
                style={{ fontSize: 11, color: "#e5e7eb" }}
              />
              {uploading && <span style={{ fontSize: 11, color: "#9ca3af" }}>uploading...</span>}
            </div>
          )}

          {/* Query test */}
          <div className="ragflow-section-label" style={{ marginTop: 10 }}>Test query</div>
          <div className="ragflow-row">
            <input
              className="ragflow-input"
              placeholder="Ask something from your docs..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && runQuery()}
            />
            <button className="ragflow-btn" onClick={runQuery} disabled={querying || !query.trim()}>
              {querying ? "..." : "Ask"}
            </button>
          </div>
          {queryResult && (
            <pre className="ragflow-result">{queryResult}</pre>
          )}
        </>
      )}

      {error && <p style={{ fontSize: 11, color: "#f87171", marginTop: 6 }}>{error}</p>}
    </div>
  );
}
