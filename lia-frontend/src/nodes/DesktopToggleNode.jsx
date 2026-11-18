/**
 * NODE: DesktopToggleNode - launch/kill external desktop overlay.
 */
import { useEffect, useState } from "react";

export default function DesktopToggleNode() {
  const [desktopOn, setDesktopOn] = useState(false);
  const [installed, setInstalled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sources, setSources] = useState([]);

  useEffect(() => {
    fetch("/api/desktop/status")
      .then(r => r.json())
      .then(d => {
        setDesktopOn(Boolean(d.running));
        setInstalled(Boolean(d.installed));
        setSources(Array.isArray(d.sources) ? d.sources : []);
        if (!d.installed && !d.running) {
          setMessage("Install MateEngine.exe or VRMViewer.exe in D:\\LIA.");
        }
      })
      .catch(() => {});
  }, []);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const action = desktopOn ? "stop" : "start";
      const resp = await fetch(`/api/desktop/${action}`, { method: "POST" });
      const data = await resp.json();
      if (Array.isArray(data.sources)) setSources(data.sources);
      if (data.status === "started" || data.status === "already_running") {
        setDesktopOn(true);
        setInstalled(true);
        setMessage("Desktop overlay running.");
      } else if (data.status === "stopped") {
        setDesktopOn(false);
        setMessage("Desktop overlay stopped.");
      } else {
        setDesktopOn(false);
        setInstalled(false);
        setMessage(data.message || "Install MateEngine.exe or VRMViewer.exe in D:\\LIA.");
      }
    } catch (e) {
      setMessage("Desktop backend failed. Restart LIA backend.");
      console.error("Desktop toggle failed:", e);
    }
    setBusy(false);
  }

  const title = desktopOn
    ? "Click to stop LIA desktop overlay"
    : installed
      ? "Launch LIA desktop overlay"
      : message || "Desktop mode is off. Overlay app is missing.";

  const primarySource = sources.find(src => /vrmviewer/i.test(src))
    || sources.find(src => /mate-engine/i.test(src))
    || sources[0];

  return (
    <div className="desktop-toggle-wrap">
      <button
        className={`desktop-toggle-btn ${desktopOn ? "active" : ""} ${!installed && !desktopOn ? "error" : ""}`}
        onClick={toggle}
        disabled={busy}
        title={title}
      >
        {busy ? "..." : desktopOn ? "Desktop ON" : installed ? "Desktop OFF" : "Setup Desktop"}
      </button>
      {message && (
        <div className="desktop-status-text" title={message}>
          {message}
          {primarySource && (
            <a href={primarySource} target="_blank" rel="noreferrer">
              Source
            </a>
          )}
        </div>
      )}
    </div>
  );
}
