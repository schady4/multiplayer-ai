import React, { useState, useEffect } from "react";
import { getApiKey, setApiKey } from "./lib/anthropic.js";

const C = {
  bg: "#0C0F14",
  line: "#242C38",
  ink: "#CAD5E0",
  dim: "#68788A",
  trunk: "#7C8CFF",
  merge: "#9AE6B4",
};
const mono = "'Berkeley Mono','SF Mono',ui-monospace,Menlo,monospace";

export default function ApiKeyBar() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSaved(!!getApiKey());
  }, []);

  function save() {
    const trimmed = key.trim();
    setApiKey(trimmed);
    setSaved(!!trimmed);
    setKey("");
  }

  function clear() {
    setApiKey("");
    setSaved(false);
  }

  return (
    <div
      style={{
        background: C.bg,
        borderBottom: `1px solid ${C.line}`,
        padding: "8px 20px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        fontFamily: mono,
        fontSize: 11.5,
      }}
    >
      <span style={{ color: saved ? C.merge : C.dim }}>
        {saved ? "✓ Anthropic API key set for this tab" : "Bring your own Anthropic API key to enable live Claude calls"}
      </span>

      {!saved ? (
        <>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-ant-..."
            onKeyDown={(e) => {
              if (e.key === "Enter" && key.trim()) save();
            }}
            style={{
              background: "#141922",
              border: `1px solid ${C.line}`,
              color: C.ink,
              padding: "5px 9px",
              borderRadius: 4,
              fontFamily: mono,
              fontSize: 11.5,
              width: 220,
            }}
          />
          <button onClick={save} disabled={!key.trim()} style={btnStyle(C.trunk)}>
            save
          </button>
        </>
      ) : (
        <button onClick={clear} style={btnStyle(C.dim)}>
          clear key
        </button>
      )}

      <a
        href="https://console.anthropic.com/settings/keys"
        target="_blank"
        rel="noreferrer"
        style={{ color: C.trunk, textDecoration: "none" }}
      >
        get a key ↗
      </a>

      <span style={{ color: C.dim, marginLeft: "auto", maxWidth: 460, lineHeight: 1.4 }}>
        Stored only in this browser tab's session storage. Sent directly to
        Anthropic's API, never anywhere else. Cleared when you close the tab.
        Without a key, everything except the Claude seat still works — CRDT
        typing, branching, and mechanical merges are pure client-side logic.
      </span>
    </div>
  );
}

function btnStyle(color) {
  return {
    background: "transparent",
    border: `1px solid ${color}66`,
    color,
    padding: "5px 11px",
    borderRadius: 5,
    fontFamily: mono,
    fontSize: 11,
  };
}
