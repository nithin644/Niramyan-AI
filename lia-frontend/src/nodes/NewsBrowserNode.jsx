import { useEffect, useMemo, useState } from "react";

export default function NewsBrowserNode({ news, large = false }) {
  const [latest, setLatest] = useState(news || null);
  const [selected, setSelected] = useState(0);
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    if (news?.items?.length) {
      setLatest(news);
      setSelected(Math.max(0, (news.selected_index || 1) - 1));
      return;
    }
    fetch("/api/news/latest")
      .then(r => r.json())
      .then(d => {
        if (d?.items?.length) setLatest(d);
      })
      .catch(() => {});
  }, [news]);

  const items = latest?.items || [];
  const item = items[selected] || items[0] || null;
  const sourceUrl = useMemo(() => item?.link || "", [item]);
  const googleWrapper = preview?.title === "Google News" && preview?.preview?.includes("aggregated from sources");

  useEffect(() => {
    if (!sourceUrl) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    setPreview(null);
    fetch(`/api/news/preview?url=${encodeURIComponent(sourceUrl)}`)
      .then(r => r.json())
      .then(d => {
        if (!cancelled) setPreview(d);
      })
      .catch(() => {
        if (!cancelled) setPreview({ success: false, message: "Could not load readable preview." });
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => { cancelled = true; };
  }, [sourceUrl]);

  return (
    <div className={`news-browser-node ${large ? "large" : ""}`}>
      <div className="news-list">
        {items.length === 0 && (
          <div className="news-empty">Ask LIA for the latest news.</div>
        )}
        {items.map((entry, index) => (
          <button
            key={`${entry.link || entry.title}-${index}`}
            className={`news-item ${index === selected ? "active" : ""}`}
            onClick={() => setSelected(index)}
            title={entry.title}
          >
            <span className="news-index">{index + 1}</span>
            <span className="news-item-main">
              <span className="news-title">{entry.title}</span>
              <span className="news-meta">{[entry.source, entry.published].filter(Boolean).join(" | ")}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="news-viewer">
        {item ? (
          <>
            <div className="news-viewer-top">
              <span>{item.title}</span>
              {sourceUrl && (
                <a href={preview?.resolved_url || sourceUrl} target="_blank" rel="noreferrer">Original</a>
              )}
            </div>
            {sourceUrl ? (
              <div className="news-preview">
                {loadingPreview && <div className="news-empty">Loading readable preview...</div>}
                {!loadingPreview && preview?.success && !googleWrapper && (
                  <>
                    {preview.title && <h3>{preview.title}</h3>}
                    {preview.description && <p className="news-description">{preview.description}</p>}
                    {preview.preview && (
                      <div className="news-preview-text">
                        {preview.preview.split(/\n{2,}/).map((para, idx) => (
                          <p key={idx}>{para}</p>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {!loadingPreview && googleWrapper && (
                  <div className="news-source-card">
                    <h3>{item.title}</h3>
                    <p>{[item.source, item.published].filter(Boolean).join(" | ")}</p>
                    <p>This source opens through a Google News wrapper, so LIA is showing the headline context here. Ask her to explain this number for a clearer breakdown.</p>
                  </div>
                )}
                {!loadingPreview && !preview?.success && (
                  <div className="news-empty">
                    {preview?.message || "This source blocked the readable preview. Use Original or ask LIA to explain the headline."}
                  </div>
                )}
              </div>
            ) : (
              <div className="news-empty">No source link for this headline.</div>
            )}
          </>
        ) : (
          <div className="news-empty">No news loaded yet.</div>
        )}
      </div>
    </div>
  );
}
