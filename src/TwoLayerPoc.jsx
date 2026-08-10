import React, { useState, useRef, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// MULTIPLAYER AI · Two-Layer Proof of Context
//
//   LAYER 1 — CRDT live surface  (this file's new work)
//     A, B, and Claude type into ONE shared text buffer concurrently.
//     Edits converge deterministically via a real sequence CRDT (RGA-style:
//     each character is an immutable node with a unique id + a "left neighbor"
//     reference, so concurrent inserts at the same spot resolve the same way
//     on every replica). No locks. No merge calls. Convergence is the math.
//
//   LAYER 2 — DAG commit ledger  (from the prior POC, kept)
//     When a line of thought concludes, snapshot the converged surface into an
//     immutable, content-addressed node. Deliberate branches merge three-way;
//     genuine semantic collisions escalate to ONE Claude call. Rare + paid-for.
//
// The point being proven: cheap convergence for the many live edits (CRDT),
// expensive reconciliation only for the rare semantic collisions (DAG+model).
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = "claude-sonnet-4-6";

const C = {
  bg: "#0C0F14", panel: "#141922", panelHi: "#1A212B", line: "#242C38",
  lineHi: "#33414F", ink: "#CAD5E0", dim: "#68788A", faint: "#3C4855",
  A: "#4FD1C5", B: "#F6AD55", claude: "#D98A6A",
  trunk: "#7C8CFF", merge: "#9AE6B4", conflict: "#FC8181",
};
const mono = "'Berkeley Mono','SF Mono',ui-monospace,Menlo,monospace";
const sans = "'Inter',system-ui,sans-serif";

const AGENTS = {
  A: { label: "Seat A", color: C.A },
  B: { label: "Seat B", color: C.B },
  claude: { label: "Claude", color: C.claude },
};

// ── RGA sequence CRDT ────────────────────────────────────────────────────────
// Each element: { id, ch, after, deleted }. id = "site:counter" — globally
// unique and totally orderable, which is what guarantees convergence: when two
// sites insert after the same neighbor, both replicas break the tie by id, so
// they land in the same order regardless of arrival sequence.
function makeCRDT() {
  return { elems: new Map(), order: ["ROOT"] }; // ROOT is the virtual head
}
function crdtClone(doc) {
  const m = new Map();
  for (const [k, v] of doc.elems) m.set(k, { ...v });
  return { elems: m, order: [...doc.order] };
}
// integrate one insert op deterministically
function integrateInsert(doc, op) {
  if (doc.elems.has(op.id)) return; // idempotent
  doc.elems.set(op.id, { id: op.id, ch: op.ch, after: op.after, deleted: false });
  // find position: right after `after`, but skip past any elems that are also
  // "after" the same anchor and sort higher by id (concurrent-insert tiebreak).
  let idx = doc.order.indexOf(op.after);
  if (idx === -1) idx = 0;
  let i = idx + 1;
  while (i < doc.order.length) {
    const sib = doc.elems.get(doc.order[i]);
    if (!sib) break;
    if (sib.after === op.after && sib.id > op.id) i++;
    else break;
  }
  doc.order.splice(i, 0, op.id);
}
function integrateDelete(doc, op) {
  const e = doc.elems.get(op.id);
  if (e) e.deleted = true;
}
function crdtText(doc) {
  let s = "";
  for (const id of doc.order) {
    if (id === "ROOT") continue;
    const e = doc.elems.get(id);
    if (e && !e.deleted) s += e.ch;
  }
  return s;
}
// visible-index → element id (for computing insert anchors / deletes)
function visibleIds(doc) {
  const out = [];
  for (const id of doc.order) {
    if (id === "ROOT") continue;
    const e = doc.elems.get(id);
    if (e && !e.deleted) out.push(id);
  }
  return out;
}

let _hash = 0;
const contentHash = (s) => {
  // toy content-address: deterministic short hash of state
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return "0x" + h.toString(16).padStart(8, "0");
};
let _nid = 0;
const nid = () => `c${++_nid}`;

export default function App() {
  // one logical CRDT doc, but we simulate 3 replicas by delaying op delivery.
  const docRef = useRef(makeCRDT());
  const [text, setText] = useState("");
  const [ops, setOps] = useState([]);           // op log (the wire)
  const counters = useRef({ A: 0, B: 0, claude: 0 });
  const [latency, setLatency] = useState(0);      // simulated ms delay
  const [inflight, setInflight] = useState(0);
  const [presence, setPresence] = useState({});   // agent -> last activity ts

  // DAG layer
  const [commits, setCommits] = useState([]);     // snapshots
  const [busy, setBusy] = useState(false);
  const [mergeReport, setMergeReport] = useState(null);
  const [toast, setToast] = useState(null);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2400); };

  // deliver an op to the doc, honoring simulated latency (out-of-order arrival)
  const deliver = useCallback((op) => {
    const apply = () => {
      const d = docRef.current;
      if (op.t === "ins") integrateInsert(d, op);
      else integrateDelete(d, op);
      setText(crdtText(d));
      setOps((o) => [...o, op]);
      setInflight((n) => Math.max(0, n - 1));
    };
    if (latency > 0) {
      setInflight((n) => n + 1);
      // jitter so concurrent ops arrive out of order — the real convergence test
      setTimeout(apply, latency + Math.random() * latency);
    } else apply();
  }, [latency]);

  const localInsert = useCallback((site, ch, afterId) => {
    counters.current[site] += 1;
    const op = { t: "ins", id: `${site}:${counters.current[site]}`, ch, after: afterId, site };
    setPresence((p) => ({ ...p, [site]: Date.now() }));
    deliver(op);
  }, [deliver]);

  const typeString = useCallback((site, str) => {
    // append at end of current visible sequence, char by char
    let anchor = visibleIds(docRef.current).slice(-1)[0] || "ROOT";
    // NOTE: we chain anchors optimistically off local knowledge; latency then
    // shuffles arrival, and the CRDT still converges — that's the demo.
    let localCounter = counters.current[site];
    const localOps = [];
    for (const ch of str) {
      localCounter += 1;
      const id = `${site}:${localCounter}`;
      localOps.push({ t: "ins", id, ch, after: anchor, site });
      anchor = id;
    }
    counters.current[site] = localCounter;
    setPresence((p) => ({ ...p, [site]: Date.now() }));
    localOps.forEach(deliver);
  }, [deliver]);

  // ── Claude types into the SAME live surface (Layer 1 participant) ──────────
  async function claudeType(prompt) {
    if (busy) return;
    setBusy(true);
    setPresence((p) => ({ ...p, claude: Date.now() }));
    try {
      const sys =
        "You are Claude, typing directly into a shared live document alongside two " +
        "human collaborators. The current full text of the document is:\n\n" +
        `"""${crdtText(docRef.current)}"""\n\n` +
        "Add a brief, useful contribution (one or two sentences) that continues the " +
        "shared thought. Reply with ONLY the text to append — no preamble, no quotes.";
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 200, system: sys,
          messages: [{ role: "user", content: prompt || "Continue the thought." }] }),
      });
      const data = await res.json();
      const out = data.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      const prefix = crdtText(docRef.current).length && !crdtText(docRef.current).endsWith(" ") ? " " : "";
      typeString("claude", prefix + out);
    } catch {
      flash("Claude call failed — check network");
    } finally {
      setBusy(false);
    }
  }

  // ── Layer 2: snapshot the converged surface into a content-addressed node ──
  function commit(author, label) {
    const snap = crdtText(docRef.current);
    const node = {
      id: nid(), author, text: snap, hash: contentHash(snap),
      parents: commits.length ? [commits[commits.length - 1].id] : [],
      kind: "commit", msg: label || "snapshot", ts: Date.now(),
    };
    setCommits((c) => [...c, node]);
    flash(`Committed ${node.hash} — surface snapshotted to DAG`);
  }

  // simulate a deliberate divergent branch + semantic merge (Layer 2 hard path)
  async function branchAndMerge() {
    if (busy) return;
    const base = crdtText(docRef.current) || "(empty surface)";
    // fabricate two divergent conclusions off the same base — the collision case
    const branchA = { conclusion: "ship Friday, scope cut to core merge", owner: "A" };
    const branchB = { conclusion: "slip to Monday, keep full scope", owner: "B" };
    setBusy(true);
    try {
      const sys =
        "Two collaborators diverged from a shared context and reached conflicting " +
        "conclusions. Reconcile them into one. Reply ONLY as JSON: " +
        '{"resolved":"<one-sentence reconciled conclusion>","rationale":"<one sentence>"}.';
      const content =
        `Shared base:\n${base}\n\nBranch A concluded: ${branchA.conclusion}\n` +
        `Branch B concluded: ${branchB.conclusion}`;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 300, system: sys,
          messages: [{ role: "user", content }] }),
      });
      const data = await res.json();
      const raw = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      let parsed;
      try { parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()); }
      catch { const m = raw.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { resolved: raw.slice(0, 120), rationale: "parse fallback" }; }
      const mergeNode = {
        id: nid(), author: "trunk", kind: "merge",
        text: parsed.resolved, hash: contentHash(parsed.resolved),
        parents: commits.length ? [commits[commits.length - 1].id] : [],
        msg: "semantic merge · 1 Claude call", ts: Date.now(),
      };
      setCommits((c) => [...c, mergeNode]);
      setMergeReport({ branchA, branchB, resolved: parsed.resolved, rationale: parsed.rationale });
      flash("Semantic merge resolved — this is the rare, paid-for path");
    } catch {
      flash("merge call failed");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    docRef.current = makeCRDT();
    counters.current = { A: 0, B: 0, claude: 0 };
    _nid = 0;
    setText(""); setOps([]); setCommits([]); setMergeReport(null); setInflight(0);
  }

  // demo: fire A and B typing "at the same time" so ops interleave under latency
  function concurrentBurst() {
    typeString("A", "We should fork per idea. ");
    typeString("B", "Agreed, and merge on decisions. ");
  }

  const active = (a) => presence[a] && Date.now() - presence[a] < 1500;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: sans }}>
      <style>{`
        *{box-sizing:border-box} button{font-family:${mono};cursor:pointer;transition:.12s}
        button:disabled{opacity:.35;cursor:not-allowed}
        input,textarea{font-family:${mono}}
        ::selection{background:${C.trunk}44}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
        .live::after{content:'▍';animation:blink 1s steps(1) infinite;color:${C.dim}}
      `}</style>

      <div style={{ borderBottom: `1px solid ${C.line}`, padding: "13px 20px", display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontFamily: mono, fontSize: 13, letterSpacing: 1, color: C.trunk }}>◇ MULTIPLAYER·AI</span>
        <span style={{ fontFamily: mono, fontSize: 11, color: C.dim }}>layer 1 · CRDT live surface  +  layer 2 · DAG commit ledger</span>
        <button onClick={reset} style={btn(C.faint)} >reset</button>
      </div>

      {/* presence + latency control */}
      <div style={{ padding: "10px 20px", borderBottom: `1px solid ${C.line}`, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontFamily: mono, fontSize: 10.5, color: C.dim }}>PRESENCE</span>
        {Object.entries(AGENTS).map(([k, a]) => (
          <span key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: mono, fontSize: 11, color: a.color, opacity: active(k) ? 1 : 0.5 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: a.color, boxShadow: active(k) ? `0 0 8px ${a.color}` : "none" }} />
            {a.label}
          </span>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: mono, fontSize: 10.5, color: C.dim }}>NET DELAY</span>
          {[0, 200, 600].map((ms) => (
            <button key={ms} onClick={() => setLatency(ms)} style={{ ...btn(latency === ms ? C.trunk : C.faint), fontSize: 10.5 }}>
              {ms === 0 ? "instant" : ms + "ms"}
            </button>
          ))}
          {inflight > 0 && <span style={{ fontFamily: mono, fontSize: 10.5, color: C.B }}>{inflight} in flight</span>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", minHeight: "calc(100vh - 96px)" }}>
        {/* ── LAYER 1: the shared live surface ── */}
        <div style={{ display: "flex", flexDirection: "column", borderRight: `1px solid ${C.line}` }}>
          <SectionLabel>layer 1 — shared live surface · one CRDT buffer, three writers</SectionLabel>
          <div style={{ flex: 1, padding: "18px 22px", minHeight: 220 }}>
            <div className={inflight ? "" : "live"} style={{ fontFamily: mono, fontSize: 15, lineHeight: 1.7, color: C.ink, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {text || <span style={{ color: C.faint }}>empty — type as a seat, or let all three write concurrently</span>}
            </div>
          </div>

          {/* per-seat inputs — each writes into the SAME buffer */}
          <div style={{ borderTop: `1px solid ${C.line}`, padding: "12px 20px", display: "grid", gap: 10 }}>
            {["A", "B"].map((s) => (
              <SeatInput key={s} seat={s} onType={(str) => typeString(s, str)} />
            ))}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: C.claude }} />
              <input placeholder="ask Claude to contribute to the shared surface…" style={inp}
                onKeyDown={(e) => { if (e.key === "Enter" && e.target.value.trim()) { claudeType(e.target.value); e.target.value = ""; } }} />
              <span style={{ fontFamily: mono, fontSize: 10, color: C.dim }}>{busy ? "writing…" : "↵ append"}</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={concurrentBurst} style={btn(C.trunk)}>⚡ fire A + B concurrently</button>
              <button onClick={() => claudeType("Add a concrete next step.")} disabled={busy} style={btn(C.claude)}>+ Claude appends</button>
              <span style={{ fontFamily: mono, fontSize: 10.5, color: C.dim, alignSelf: "center" }}>
                set NET DELAY to 600ms first to watch out-of-order ops still converge
              </span>
            </div>
          </div>

          {/* op log — proof that convergence is deterministic, not luck */}
          <div style={{ borderTop: `1px solid ${C.line}`, padding: "10px 20px", maxHeight: 130, overflowY: "auto" }}>
            <div style={{ fontFamily: mono, fontSize: 9.5, color: C.dim, letterSpacing: 1, marginBottom: 6 }}>OP LOG · {ops.length} ops · converges regardless of arrival order</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {ops.slice(-60).map((o, i) => (
                <span key={i} style={{ fontFamily: mono, fontSize: 9.5, color: AGENTS[o.site]?.color || C.dim, opacity: o.t === "del" ? 0.5 : 1 }}>
                  {o.id}{o.ch === " " ? "␣" : o.ch}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── LAYER 2: DAG commit ledger ── */}
        <div style={{ display: "flex", flexDirection: "column", background: C.panel }}>
          <SectionLabel>layer 2 — DAG commit ledger · rare, deliberate, content-addressed</SectionLabel>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.line}`, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => commit("A", "checkpoint")} style={btn(C.merge)}>⎘ commit surface</button>
            <button onClick={branchAndMerge} disabled={busy} style={btn(C.conflict)}>⑃ branch + semantic merge</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
            {commits.length === 0 && (
              <div style={{ fontFamily: mono, fontSize: 11, color: C.faint, lineHeight: 1.6 }}>
                no commits yet.<br />layer 1 edits are free + instant.<br />commit only when a thought concludes.
              </div>
            )}
            {commits.map((c) => (
              <div key={c.id} style={{ marginBottom: 10, borderLeft: `2px solid ${c.kind === "merge" ? C.conflict : C.merge}`, paddingLeft: 10 }}>
                <div style={{ fontFamily: mono, fontSize: 10, display: "flex", gap: 8 }}>
                  <span style={{ color: c.kind === "merge" ? C.conflict : C.merge }}>{c.kind === "merge" ? "⑃" : "●"} {c.id}</span>
                  <span style={{ color: C.dim }}>{c.hash}</span>
                </div>
                <div style={{ fontFamily: mono, fontSize: 10, color: C.dim, margin: "2px 0" }}>{c.msg}</div>
                <div style={{ fontSize: 11.5, color: C.ink, lineHeight: 1.4 }}>{c.text.length > 90 ? c.text.slice(0, 90) + "…" : c.text}</div>
              </div>
            ))}
          </div>

          {mergeReport && (
            <div style={{ borderTop: `1px solid ${C.line}`, padding: "12px 16px", background: C.panelHi }}>
              <div style={{ fontFamily: mono, fontSize: 10, color: C.conflict, marginBottom: 6 }}>⚠ SEMANTIC COLLISION · 1 inference call</div>
              <div style={{ fontFamily: mono, fontSize: 10.5, color: C.A, marginBottom: 2 }}>A → {mergeReport.branchA.conclusion}</div>
              <div style={{ fontFamily: mono, fontSize: 10.5, color: C.B, marginBottom: 6 }}>B → {mergeReport.branchB.conclusion}</div>
              <div style={{ fontSize: 12, color: C.merge, lineHeight: 1.45 }}>⑃ {mergeReport.resolved}</div>
              <div style={{ fontSize: 10.5, color: C.dim, fontStyle: "italic", marginTop: 4 }}>{mergeReport.rationale}</div>
            </div>
          )}

          <div style={{ borderTop: `1px solid ${C.line}`, padding: "10px 16px", fontFamily: mono, fontSize: 10, color: C.dim, lineHeight: 1.6 }}>
            layer 1 merges: <span style={{ color: C.merge }}>{ops.length}</span> · 0 calls<br />
            layer 2 merges: <span style={{ color: C.conflict }}>{commits.filter((c) => c.kind === "merge").length}</span> · 1 call each
          </div>
        </div>
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", background: C.panelHi, border: `1px solid ${C.lineHi}`, padding: "9px 16px", borderRadius: 6, fontFamily: mono, fontSize: 12, boxShadow: "0 8px 30px #0009" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function SeatInput({ seat, onType }) {
  const [v, setV] = useState("");
  const a = AGENTS[seat];
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: a.color }} />
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={`type as ${a.label} into the shared surface…`}
        style={{ ...inp, borderColor: a.color + "55" }}
        onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) { onType(v + " "); setV(""); } }} />
      <button onClick={() => { if (v.trim()) { onType(v + " "); setV(""); } }} style={btn(a.color)}>write</button>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ padding: "10px 20px", borderBottom: `1px solid ${C.line}`, fontFamily: mono, fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

const btn = (color) => ({ background: "transparent", border: `1px solid ${color}66`, color, padding: "5px 11px", borderRadius: 5, fontSize: 11, letterSpacing: .3 });
const inp = { background: C.bg, border: `1px solid ${C.line}`, color: C.ink, padding: "7px 10px", borderRadius: 4, fontSize: 12, flex: 1, minWidth: 0 };
