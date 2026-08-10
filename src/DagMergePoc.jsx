import React, { useState, useRef, useEffect, useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Multiplayer AI — Fork / Merge Proof of Context
//
// What this proves (the invariant, not production polish):
//   1. A shared context ("trunk") can be FORKED into independent branches.
//   2. Two seats + Claude advance branches in parallel, each a full context.
//   3. Branches MERGE back against a common ancestor:
//        - non-overlapping edits reconcile MECHANICALLY (zero inference)
//        - genuine collisions ESCALATE to a single Claude call (semantic merge)
//   4. Unmerged disagreement can persist as real structure, not a flattened log.
//
// The DAG lives in React state (POC). The two seams you'd later point at your
// own backend are runBranchTurn() and mergeConflict(). Everything else is infra
// that's already a solved problem to scale.
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = "claude-sonnet-4-6";

// ── palette / type: "cold-storage terminal" — steel, oxide, phosphor ─────────
const C = {
  bg: "#0E1116",
  panel: "#151A21",
  panelHi: "#1B222B",
  line: "#252D38",
  lineHi: "#33404E",
  ink: "#C9D4DF",
  dim: "#6B7A8A",
  faint: "#3F4B58",
  trunk: "#7C8CFF",   // shared truth
  seatA: "#4FD1C5",   // teal
  seatB: "#F6AD55",   // amber
  claude: "#D98A6A",  // oxide — the third party
  merge: "#9AE6B4",   // clean merge
  conflict: "#FC8181", // collision
};

const mono = "'Berkeley Mono','SF Mono',ui-monospace,Menlo,monospace";
const sans = "'Inter',system-ui,sans-serif";

// ── the shared state: a tiny key→value "belief store" (toy-sized on purpose) ──
const SEED = {
  goal: "ship the fork-merge POC",
  owner: "unassigned",
  deadline: "friday",
};

let _id = 0;
const nid = () => `n${++_id}`;

// A node in the DAG. Each is a stamped, replayable event.
function makeNode({ kind, author, parents, state, delta, msg, meta }) {
  return {
    id: nid(),
    kind,                    // 'root' | 'edit' | 'merge'
    author,                  // 'trunk' | 'seatA' | 'seatB' | 'claude'
    parents: parents || [],
    state,                   // full resolved state at this node (toy: cheap to store)
    delta: delta || null,    // {key,value} that changed vs parent
    msg: msg || "",
    meta: meta || {},
    ts: Date.now(),
  };
}

// three-way merge against common ancestor. Returns either a clean result or a
// list of conflicts that need semantic (Claude) resolution.
function threeWayMerge(ancestor, a, b) {
  const keys = new Set([
    ...Object.keys(ancestor),
    ...Object.keys(a),
    ...Object.keys(b),
  ]);
  const merged = {};
  const conflicts = [];
  for (const k of keys) {
    const base = ancestor[k];
    const av = a[k];
    const bv = b[k];
    const aChanged = av !== base;
    const bChanged = bv !== base;
    if (aChanged && bChanged && av !== bv) {
      conflicts.push({ key: k, base, a: av, b: bv });
      merged[k] = base; // hold ancestor until resolved
    } else if (bChanged) {
      merged[k] = bv;
    } else if (aChanged) {
      merged[k] = av;
    } else {
      merged[k] = base;
    }
  }
  return { merged, conflicts };
}

// ── Claude seam #1: advance a branch. Stateless — we pass the branch's context.
async function runBranchTurn(branchState, history, userInput) {
  const sys =
    "You are Claude, a third participant collaborating inside a shared, forkable " +
    "workspace. The current branch's belief-state (a small key/value store) is:\n" +
    JSON.stringify(branchState, null, 2) +
    "\n\nYou may propose a change to exactly one key. Reply with ONLY a JSON object, " +
    'no markdown, no preamble, shaped: {"say": "<one short sentence to the room>", ' +
    '"edit": {"key": "<existing or new key>", "value": "<new value>"} | null}. ' +
    "Set edit to null if you're only commenting.";
  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userInput },
  ];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, system: sys, messages }),
  });
  const data = await res.json();
  const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return safeJson(text, { say: text.slice(0, 160), edit: null });
}

// ── Claude seam #2: resolve ONLY genuine collisions. One call per merge, and
//    only when threeWayMerge found conflicts. This is the cost discipline.
async function mergeConflict(ancestor, branchA, branchB, conflicts) {
  const sys =
    "You reconcile conflicting edits in a shared workspace. Given a common ancestor " +
    "and two branches that changed the same keys incompatibly, choose or synthesize " +
    "the best value for each conflicted key. Reply with ONLY a JSON object, no " +
    'markdown: {"resolved": {"<key>": "<value>", ...}, "rationale": "<one sentence>"}.';
  const content =
    `Ancestor:\n${JSON.stringify(ancestor)}\n\n` +
    `Branch A:\n${JSON.stringify(branchA)}\n\n` +
    `Branch B:\n${JSON.stringify(branchB)}\n\n` +
    `Conflicted keys:\n${JSON.stringify(conflicts.map((c) => c.key))}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system: sys,
      messages: [{ role: "user", content }],
    }),
  });
  const data = await res.json();
  const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return safeJson(text, {
    resolved: Object.fromEntries(conflicts.map((c) => [c.key, c.b])),
    rationale: "fallback: took branch B on parse failure",
  });
}

function safeJson(text, fallback) {
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {}
    }
    return fallback;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const SEATS = {
  seatA: { label: "Seat A", color: C.seatA },
  seatB: { label: "Seat B", color: C.seatB },
  claude: { label: "Claude", color: C.claude },
  trunk: { label: "trunk", color: C.trunk },
};

export default function App() {
  const rootRef = useRef(makeNode({ kind: "root", author: "trunk", state: { ...SEED }, msg: "shared context created" }));
  const [nodes, setNodes] = useState({ [rootRef.current.id]: rootRef.current });
  const [order, setOrder] = useState([rootRef.current.id]); // dag order for drawing

  // two live branches, each pointing at a head node id. null = not yet forked.
  const [heads, setHeads] = useState({ seatA: null, seatB: null });
  const forkPoint = useRef(rootRef.current.id); // common ancestor for the next merge

  const [chatA, setChatA] = useState([]);
  const [chatB, setChatB] = useState([]);
  const [draftA, setDraftA] = useState("");
  const [draftB, setDraftB] = useState("");
  const [busy, setBusy] = useState(null);
  const [mergeReport, setMergeReport] = useState(null);
  const [toast, setToast] = useState(null);

  const node = (id) => nodes[id];
  const headState = (seat) => (heads[seat] ? node(heads[seat]).state : node(forkPoint.current).state);

  function pushNode(n) {
    setNodes((prev) => ({ ...prev, [n.id]: n }));
    setOrder((prev) => [...prev, n.id]);
  }

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  function fork() {
    const anc = forkPoint.current;
    setHeads({ seatA: anc, seatB: anc });
    setChatA([]);
    setChatB([]);
    setMergeReport(null);
    flash(`Forked from ${anc} — two branches now advance independently`);
  }

  // a human edit on a seat's branch
  function humanEdit(seat, key, value, say) {
    const parent = heads[seat];
    const state = { ...node(parent).state, [key]: value };
    const n = makeNode({
      kind: "edit",
      author: seat,
      parents: [parent],
      state,
      delta: { key, value },
      msg: say || `set ${key} = ${value}`,
    });
    pushNode(n);
    setHeads((h) => ({ ...h, [seat]: n.id }));
  }

  async function sendToClaude(seat) {
    const draft = seat === "seatA" ? draftA : draftB;
    if (!draft.trim() || busy) return;
    const setChat = seat === "seatA" ? setChatA : setChatB;
    const chat = seat === "seatA" ? chatA : chatB;
    const setDraft = seat === "seatA" ? setDraftA : setDraftB;

    setChat((c) => [...c, { role: "user", content: draft, who: seat }]);
    setDraft("");
    setBusy(seat);
    try {
      const result = await runBranchTurn(headState(seat), chat, draft);
      setChat((c) => [...c, { role: "assistant", content: result.say, who: "claude", edit: result.edit }]);
      if (result.edit && result.edit.key) {
        const parent = heads[seat];
        const state = { ...node(parent).state, [result.edit.key]: result.edit.value };
        const n = makeNode({
          kind: "edit",
          author: "claude",
          parents: [parent],
          state,
          delta: { key: result.edit.key, value: result.edit.value },
          msg: `${result.edit.key} = ${result.edit.value}`,
        });
        pushNode(n);
        setHeads((h) => ({ ...h, [seat]: n.id }));
      }
    } catch (e) {
      setChat((c) => [...c, { role: "assistant", content: "(call failed — check network)", who: "claude" }]);
    } finally {
      setBusy(null);
    }
  }

  async function doMerge() {
    if (!heads.seatA || !heads.seatB || busy) return;
    const ancestor = node(forkPoint.current).state;
    const a = node(heads.seatA).state;
    const b = node(heads.seatB).state;
    const { merged, conflicts } = threeWayMerge(ancestor, a, b);

    if (conflicts.length === 0) {
      const n = makeNode({
        kind: "merge",
        author: "trunk",
        parents: [heads.seatA, heads.seatB],
        state: merged,
        msg: "clean merge — no inference",
        meta: { clean: true },
      });
      pushNode(n);
      forkPoint.current = n.id;
      setHeads({ seatA: null, seatB: null });
      setMergeReport({ clean: true, conflicts: [], resolved: merged });
      flash("Merged mechanically — 0 Claude calls");
      return;
    }

    // escalate ONLY the collisions
    setBusy("merge");
    try {
      const res = await mergeConflict(ancestor, a, b, conflicts);
      const finalState = { ...merged, ...res.resolved };
      const n = makeNode({
        kind: "merge",
        author: "trunk",
        parents: [heads.seatA, heads.seatB],
        state: finalState,
        msg: `semantic merge — ${conflicts.length} collision${conflicts.length > 1 ? "s" : ""} resolved`,
        meta: { clean: false, rationale: res.rationale, conflicts },
      });
      pushNode(n);
      forkPoint.current = n.id;
      setHeads({ seatA: null, seatB: null });
      setMergeReport({ clean: false, conflicts, resolved: res.resolved, rationale: res.rationale, finalState });
      flash(`Semantic merge — 1 Claude call for ${conflicts.length} collision(s)`);
    } catch (e) {
      flash("merge call failed");
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    _id = 0;
    const r = makeNode({ kind: "root", author: "trunk", state: { ...SEED }, msg: "shared context created" });
    rootRef.current = r;
    forkPoint.current = r.id;
    setNodes({ [r.id]: r });
    setOrder([r.id]);
    setHeads({ seatA: null, seatB: null });
    setChatA([]); setChatB([]); setMergeReport(null);
  }

  const forked = heads.seatA && heads.seatB;
  const canMerge = forked;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: sans }}>
      <style>{`
        * { box-sizing: border-box; }
        button { font-family: ${mono}; cursor: pointer; transition: all .12s; }
        button:disabled { opacity: .35; cursor: not-allowed; }
        input, textarea { font-family: ${mono}; }
        ::selection { background: ${C.trunk}44; }
        .seat-in:focus { outline: 2px solid ${C.lineHi}; outline-offset: -1px; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
      `}</style>

      {/* header */}
      <div style={{ borderBottom: `1px solid ${C.line}`, padding: "14px 20px", display: "flex", alignItems: "baseline", gap: 14 }}>
        <span style={{ fontFamily: mono, fontSize: 13, letterSpacing: 1, color: C.trunk }}>◇ MULTIPLAYER·AI</span>
        <span style={{ fontFamily: mono, fontSize: 11, color: C.dim }}>fork · advance · merge — a shared, forkable context with Claude as third party</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={reset} style={btn(C.faint)}>reset</button>
        </div>
      </div>

      {/* controls */}
      <div style={{ padding: "12px 20px", display: "flex", gap: 10, alignItems: "center", borderBottom: `1px solid ${C.line}`, flexWrap: "wrap" }}>
        <button onClick={fork} disabled={!!forked} style={btn(C.trunk)}>⑂ fork from {forkPoint.current}</button>
        <button onClick={doMerge} disabled={!canMerge || busy === "merge"} style={btn(C.merge)}>
          {busy === "merge" ? "resolving…" : "⑃ merge branches"}
        </button>
        <span style={{ fontFamily: mono, fontSize: 11, color: C.dim, marginLeft: 6 }}>
          {forked ? "branches live — advance each, then merge" : "not forked — trunk is single-threaded"}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 340px", gap: 0, minHeight: "calc(100vh - 108px)" }}>
        <Seat seat="seatA" heads={heads} node={node} chat={chatA} draft={draftA} setDraft={setDraftA}
          onSend={() => sendToClaude("seatA")} onEdit={humanEdit} busy={busy} forked={!!forked} />
        <Seat seat="seatB" heads={heads} node={node} chat={chatB} draft={draftB} setDraft={setDraftB}
          onSend={() => sendToClaude("seatB")} onEdit={humanEdit} busy={busy} forked={!!forked} border />

        {/* DAG + report */}
        <div style={{ borderLeft: `1px solid ${C.line}`, background: C.panel, display: "flex", flexDirection: "column" }}>
          <Panel title="DAG · commit graph">
            <Dag order={order} node={node} heads={heads} forkPoint={forkPoint.current} />
          </Panel>
          <Panel title="trunk · shared truth" grow>
            <StateView state={node(forkPoint.current).state} accent={C.trunk} />
            {forked && (
              <div style={{ marginTop: 10, fontSize: 10.5, color: C.dim, fontFamily: mono, lineHeight: 1.5 }}>
                trunk is frozen at the fork point while branches diverge. it updates only on merge.
              </div>
            )}
            {mergeReport && <MergeReport r={mergeReport} />}
          </Panel>
        </div>
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", background: C.panelHi, border: `1px solid ${C.lineHi}`, color: C.ink, padding: "9px 16px", borderRadius: 6, fontFamily: mono, fontSize: 12, boxShadow: "0 8px 30px #0008" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function Seat({ seat, heads, node, chat, draft, setDraft, onSend, onEdit, busy, forked, border }) {
  const meta = SEATS[seat];
  const head = heads[seat];
  const state = head ? node(head).state : null;
  const [key, setKey] = useState("owner");
  const [val, setVal] = useState("");

  return (
    <div style={{ background: C.panel, borderLeft: border ? `1px solid ${C.line}` : "none", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: meta.color }} />
        <span style={{ fontFamily: mono, fontSize: 12, color: meta.color, letterSpacing: .5 }}>{meta.label}</span>
        <span style={{ fontFamily: mono, fontSize: 10.5, color: C.dim, marginLeft: "auto" }}>
          {head ? `head ${head}` : "idle — fork to begin"}
        </span>
      </div>

      {!forked ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, fontFamily: mono, fontSize: 12, padding: 20, textAlign: "center" }}>
          fork the trunk to open<br />this branch
        </div>
      ) : (
        <>
          {/* branch state */}
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.line}` }}>
            <StateView state={state} accent={meta.color} compact />
          </div>

          {/* direct edit */}
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.line}`, display: "flex", gap: 6, alignItems: "center" }}>
            <input value={key} onChange={(e) => setKey(e.target.value)} className="seat-in"
              style={inp(90)} placeholder="key" />
            <input value={val} onChange={(e) => setVal(e.target.value)} className="seat-in"
              style={inp(null)} placeholder="value" onKeyDown={(e) => { if (e.key === "Enter" && val) { onEdit(seat, key, val, null); setVal(""); } }} />
            <button onClick={() => { if (val) { onEdit(seat, key, val, null); setVal(""); } }} style={btn(meta.color)}>set</button>
          </div>

          {/* claude chat */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 16px", minHeight: 120 }}>
            {chat.length === 0 && (
              <div style={{ color: C.faint, fontFamily: mono, fontSize: 11, lineHeight: 1.6 }}>
                talk to Claude on this branch. it can propose an edit to one key,<br />
                which commits a node authored by claude.
              </div>
            )}
            {chat.map((m, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ fontFamily: mono, fontSize: 9.5, color: m.who === "claude" ? C.claude : meta.color, marginBottom: 3, letterSpacing: .5 }}>
                  {m.who === "claude" ? "CLAUDE" : meta.label.toUpperCase()}
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.ink }}>{m.content}</div>
                {m.edit && m.edit.key && (
                  <div style={{ marginTop: 4, fontFamily: mono, fontSize: 10.5, color: C.claude }}>
                    ⤷ committed {m.edit.key} = {m.edit.value}
                  </div>
                )}
              </div>
            ))}
            {busy === seat && <div style={{ fontFamily: mono, fontSize: 11, color: C.dim, animation: "pulse 1s infinite" }}>Claude is thinking…</div>}
          </div>

          <div style={{ padding: "10px 16px", borderTop: `1px solid ${C.line}`, display: "flex", gap: 6 }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} className="seat-in"
              style={inp(null)} placeholder="ask Claude on this branch…"
              onKeyDown={(e) => { if (e.key === "Enter") onSend(); }} disabled={busy === seat} />
            <button onClick={onSend} disabled={busy === seat || !draft.trim()} style={btn(C.claude)}>send</button>
          </div>
        </>
      )}
    </div>
  );
}

function StateView({ state, accent, compact }) {
  return (
    <div style={{ fontFamily: mono, fontSize: compact ? 11 : 12 }}>
      {Object.entries(state).map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: 8, padding: "2px 0", borderBottom: `1px solid ${C.line}55` }}>
          <span style={{ color: C.dim, minWidth: 68 }}>{k}</span>
          <span style={{ color: accent }}>{String(v)}</span>
        </div>
      ))}
    </div>
  );
}

function Dag({ order, node, heads, forkPoint }) {
  const colorFor = (a) => SEATS[a]?.color || C.dim;
  return (
    <div style={{ fontFamily: mono, fontSize: 11, lineHeight: 1.5, maxHeight: 200, overflowY: "auto" }}>
      {order.map((id) => {
        const n = node(id);
        const isHead = heads.seatA === id || heads.seatB === id;
        const isFork = id === forkPoint;
        const glyph = n.kind === "root" ? "●" : n.kind === "merge" ? "⑃" : "○";
        return (
          <div key={id} style={{ display: "flex", gap: 7, alignItems: "baseline", padding: "1px 0", opacity: n.kind === "root" ? .9 : 1 }}>
            <span style={{ color: n.kind === "merge" ? (n.meta.clean ? C.merge : C.conflict) : colorFor(n.author) }}>{glyph}</span>
            <span style={{ color: C.faint, minWidth: 26 }}>{id}</span>
            <span style={{ color: colorFor(n.author), minWidth: 42 }}>{SEATS[n.author]?.label || n.author}</span>
            <span style={{ color: C.dim, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.msg}</span>
            {isFork && <span style={{ color: C.trunk }}>◇base</span>}
            {isHead && <span style={{ color: C.merge }}>◂head</span>}
          </div>
        );
      })}
    </div>
  );
}

function MergeReport({ r }) {
  return (
    <div style={{ marginTop: 12, border: `1px solid ${r.clean ? C.merge + "55" : C.conflict + "55"}`, borderRadius: 6, overflow: "hidden" }}>
      <div style={{ padding: "6px 10px", background: (r.clean ? C.merge : C.conflict) + "18", fontFamily: mono, fontSize: 11, color: r.clean ? C.merge : C.conflict }}>
        {r.clean ? "✓ clean merge · 0 inference" : `⚠ ${r.conflicts.length} collision(s) · 1 Claude call`}
      </div>
      <div style={{ padding: "8px 10px" }}>
        {!r.clean && r.conflicts.map((c) => (
          <div key={c.key} style={{ fontFamily: mono, fontSize: 10.5, marginBottom: 6, lineHeight: 1.5 }}>
            <div style={{ color: C.ink }}>{c.key}</div>
            <div style={{ color: C.dim }}>base <span style={{ color: C.faint }}>{c.base}</span></div>
            <div style={{ color: C.seatA }}>A → {c.a}</div>
            <div style={{ color: C.seatB }}>B → {c.b}</div>
            <div style={{ color: C.merge }}>⑃ {r.resolved[c.key]}</div>
          </div>
        ))}
        {!r.clean && r.rationale && (
          <div style={{ fontSize: 11, color: C.dim, fontStyle: "italic", marginTop: 4, lineHeight: 1.5 }}>{r.rationale}</div>
        )}
        {r.clean && <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.5 }}>edits touched different keys — reconciled by diff logic alone.</div>}
      </div>
    </div>
  );
}

function Panel({ title, children, grow }) {
  return (
    <div style={{ borderBottom: `1px solid ${C.line}`, padding: "12px 16px", flex: grow ? 1 : "none", minHeight: 0 }}>
      <div style={{ fontFamily: mono, fontSize: 10, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

const btn = (color) => ({
  background: "transparent",
  border: `1px solid ${color}66`,
  color,
  padding: "5px 11px",
  borderRadius: 5,
  fontSize: 11.5,
  letterSpacing: .3,
});
const inp = (w) => ({
  background: C.bg,
  border: `1px solid ${C.line}`,
  color: C.ink,
  padding: "6px 9px",
  borderRadius: 4,
  fontSize: 12,
  width: w ? w : "auto",
  flex: w ? "none" : 1,
  minWidth: 0,
});
