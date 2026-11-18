/**
 * NODE: VRMSwitcherNode - media drawer for VRM characters and backgrounds.
 */
import { useState, useEffect, useRef } from "react";

export default function VRMSwitcherNode({ currentPath, onSwitch, currentBackground, onBackground }) {
  const [models, setModels] = useState([]);
  const [backgrounds, setBackgrounds] = useState([]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("vrm");
  const [uploading, setUploading] = useState(false);
  const vrmInputRef = useRef(null);
  const bgInputRef = useRef(null);

  useEffect(() => {
    refreshModels();
    refreshBackgrounds();
  }, []);

  async function refreshModels() {
    fetch("/api/vrm/list")
      .then(r => r.json())
      .then(d => setModels(d.models ?? []))
      .catch(() => {});
  }

  async function refreshBackgrounds() {
    fetch("/api/background/list")
      .then(r => r.json())
      .then(d => setBackgrounds(d.backgrounds ?? []))
      .catch(() => {});
  }

  function selectModel(filename) {
    const path = `/models/${filename}`;
    if (path !== currentPath) onSwitch?.(path);
  }

  function selectBackground(filename) {
    onBackground?.(filename ? `/backgrounds/${filename}` : "/bg.jpg");
  }

  async function uploadFile(file, endpoint, afterUpload) {
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const resp = await fetch(endpoint, { method: "POST", body: form });
      const data = await resp.json();
      if (data.filename) afterUpload(data.filename);
    } catch {}
    setUploading(false);
  }

  async function handleVrmUpload(e) {
    const file = e.target.files?.[0];
    await uploadFile(file, "/api/vrm/upload", filename => {
      setModels(prev => [...new Set([...prev, filename])].sort());
      selectModel(filename);
    });
    e.target.value = "";
  }

  async function handleBgUpload(e) {
    const file = e.target.files?.[0];
    await uploadFile(file, "/api/background/upload", filename => {
      setBackgrounds(prev => [...new Set([...prev, filename])].sort());
      selectBackground(filename);
    });
    e.target.value = "";
  }

  const currentName = currentPath.split("/").pop().replace(".vrm", "");
  const bgName = currentBackground?.split("/").pop() || "bg.jpg";

  return (
    <div className="media-switcher">
      <button
        className="media-current-btn"
        onClick={() => setOpen(o => !o)}
        title="Characters and backgrounds"
      >
        <span className="media-icon">LIA</span>
        <span className="media-name">{currentName}</span>
        <span className="media-arrow">{open ? "x" : "menu"}</span>
      </button>

      {open && (
        <div className="media-drawer">
          <div className="media-tabs">
            <button className={tab === "vrm" ? "active" : ""} onClick={() => setTab("vrm")}>VRM</button>
            <button className={tab === "bg" ? "active" : ""} onClick={() => setTab("bg")}>BG</button>
          </div>

          {tab === "vrm" ? (
            <>
              <div className="media-list">
                {models.map(m => (
                  <button
                    key={m}
                    className={`media-item ${currentPath === `/models/${m}` ? "active" : ""}`}
                    onClick={() => selectModel(m)}
                  >
                    {m.replace(".vrm", "")}
                  </button>
                ))}
                {models.length === 0 && <div className="media-empty">No VRMs</div>}
              </div>
              <button className="media-upload-btn" onClick={() => vrmInputRef.current?.click()} disabled={uploading}>
                {uploading ? "Uploading..." : "Upload VRM"}
              </button>
              <input ref={vrmInputRef} type="file" accept=".vrm" hidden onChange={handleVrmUpload} />
            </>
          ) : (
            <>
              <div className="media-list">
                <button className={`media-item ${currentBackground === "/bg.jpg" ? "active" : ""}`} onClick={() => selectBackground("")}>
                  Default bg.jpg
                </button>
                {backgrounds.map(bg => (
                  <button
                    key={bg}
                    className={`media-item ${bgName === bg ? "active" : ""}`}
                    onClick={() => selectBackground(bg)}
                  >
                    {bg}
                  </button>
                ))}
              </div>
              <button className="media-upload-btn" onClick={() => bgInputRef.current?.click()} disabled={uploading}>
                {uploading ? "Uploading..." : "Upload Background"}
              </button>
              <input ref={bgInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleBgUpload} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
