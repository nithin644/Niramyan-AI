import { useState, useEffect } from "react";

export default function QuickSwitchBar() {
  const [pcOn,   setPcOn]   = useState(false);
  const [cashOn, setCashOn] = useState(false);

  useEffect(() => {
    fetch("/api/capabilities")
      .then(r => r.json())
      .then(d => {
        const sw = d?.switches ?? {};
        setPcOn(sw.pc_control ?? false);
        setCashOn(sw.cashclaw ?? false);
      })
      .catch(() => {});
  }, []);

  async function toggle(name, current, setter) {
    const next = !current;
    setter(next);
    try {
      const resp = await fetch("/api/capabilities/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, enabled: next }),
      });
      const data = await resp.json();
      window.dispatchEvent(new CustomEvent("lia-capabilities-changed", { detail: data }));
    } catch {
      setter(current);
    }
  }

  return (
    <div className="quick-switch-bar">
      <button
        className={`quick-switch-btn ${pcOn ? "on" : ""}`}
        onClick={() => toggle("pc_control", pcOn, setPcOn)}
        title={pcOn ? "PC Control ON — LIA controls your PC" : "PC Control OFF — click to enable"}
      >
        💻 PC Control <span className={`qsw-dot ${pcOn ? "on" : ""}`} />
      </button>
      <button
        className={`quick-switch-btn ${cashOn ? "on" : ""}`}
        onClick={() => toggle("cashclaw", cashOn, setCashOn)}
        title={cashOn ? "Creator Roast ON - LIA uses comedy persona" : "Creator Roast OFF - click to enable"}
      >
        Creator Roast <span className={`qsw-dot ${cashOn ? "on" : ""}`} />
      </button>
    </div>
  );
}
