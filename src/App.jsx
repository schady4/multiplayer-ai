import React, { useState } from "react";
import TwoLayerPoc from "./TwoLayerPoc.jsx";
import DagMergePoc from "./DagMergePoc.jsx";
import ApiKeyBar from "./ApiKeyBar.jsx";

const C = {
  bg: "#0C0F14",
  line: "#242C38",
  ink: "#CAD5E0",
  dim: "#68788A",
  trunk: "#7C8CFF",
};
const mono = "'Berkeley Mono','SF Mono',ui-monospace,Menlo,monospace";

const TABS = [
  { id: "two-layer", label: "Two-Layer POC", Component: TwoLayerPoc },
  { id: "dag-merge", label: "DAG Merge POC", Component: DagMergePoc },
];

export default function App() {
  const [tab, setTab] = useState(TABS[0].id);
  const Active = TABS.find((t) => t.id === tab).Component;

  return (
    <div style={{ background: C.bg, minHeight: "100vh" }}>
      <ApiKeyBar />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 20px",
          borderBottom: `1px solid ${C.line}`,
          fontFamily: mono,
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: t.id === tab ? `${C.trunk}22` : "transparent",
              border: `1px solid ${t.id === tab ? C.trunk : C.line}`,
              color: t.id === tab ? C.trunk : C.dim,
              padding: "6px 13px",
              borderRadius: 5,
              fontFamily: mono,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
        <a
          href="https://github.com/schady4/multiplayer-ai"
          target="_blank"
          rel="noreferrer"
          style={{ color: C.dim, fontSize: 11.5, marginLeft: "auto", textDecoration: "none" }}
        >
          view source ↗
        </a>
      </div>
      {/* key resets component state on tab switch instead of leaking it across POCs */}
      <Active key={tab} />
    </div>
  );
}
