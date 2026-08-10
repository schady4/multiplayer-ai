# Multiplayer AI — Proof of Context

A working proof-of-context for **multiplayer AI**: a shared, forkable, live
collaborative surface where multiple humans and an AI agent think together in
the same context — and where divergent lines of thought can branch and merge
back into a unified truth.

Built by **Jarett Schadlich**.

---

## The idea

Most AI today is single-player: one user, one model, one private chat window.
When you want to collaborate, the best you can usually do is pass around a
read-only transcript nobody else can steer.

The more valuable version looks less like a solo chat and more like a live
Google Doc or a Figma canvas — a shared workspace anyone can drop into, watch
the agent work, redirect it, and hand off. That raises a hard question: how do
you let several people (and an agent) work in the *same* context at once, let
their thinking diverge when it needs to, and then reconcile it back into one
coherent shared state — without either dropping anyone's work or forcing every
edit through an expensive negotiation?

This repo answers that with a **two-layer architecture**, and demonstrates each
layer in a runnable POC.

---

## The architecture

The core insight: real-time collaboration and version-control semantics pull
toward *different* data structures, and you need both.

### Layer 1 — CRDT live surface (cheap, instant convergence)

The surface everyone is typing into *right now* is a **CRDT** (Conflict-free
Replicated Data Type) — specifically an RGA-style sequence CRDT. Each character
is an immutable node with a globally unique, totally-orderable id and a
reference to its left neighbor. Concurrent inserts from different writers
resolve to the *same* order on every replica, deterministically, with **no
locks and no merge calls**. Convergence is the math, not a negotiation.

This is where "as fast as thought" is a coherent goal: most collaboration is
compatible edits (different people touching different things), and CRDTs
dissolve those for free.

### Layer 2 — DAG commit ledger (rare, deliberate reconciliation)

When a line of thought *concludes*, the converged surface is snapshotted into
an immutable, **content-addressed** node in a DAG. Deliberate branches merge
three-way against a common ancestor. The many non-overlapping edits reconcile
**mechanically, with zero inference**. Only genuine semantic collisions — two
branches changing the same belief incompatibly — escalate to a **single AI
call** to arbitrate.

This puts each merge cost where it belongs: trivial concurrent edits are free
(CRDT), and expensive semantic reconciliation is paid for only when it's
genuinely needed (DAG + model).

A pure DAG forces *everything* through the expensive path. A pure CRDT gives
you fast collaboration but no branching model and no provenance. The two fail
in opposite directions, which is why multiplayer AI needs both at once.

---

## What's in here

| File | What it demonstrates |
|------|----------------------|
| `src/TwoLayerPoc.jsx` | **The full system.** A live CRDT surface where two seats + Claude type concurrently and converge with zero merge calls (dial up simulated network delay to watch out-of-order ops still converge), sitting on a DAG commit ledger where only real semantic collisions cost an inference call. |
| `src/DagMergePoc.jsx` | **The DAG layer in isolation.** Fork a shared context into two branches, advance each (directly or via Claude), then merge — clean merges reconcile mechanically, collisions escalate to one Claude call with a rationale. |

Both are single-file React components.

---

## Running it

These components were built to run as Claude.ai Artifacts, and call the
Anthropic API through the in-artifact endpoint (no API key needed there). To
run them in your own environment, drop either component into a React app
(Vite + React works well) and point the two integration seams at your backend:

- `runBranchTurn()` / `claudeType()` — advance a branch / write to the surface
- `mergeConflict()` / `branchAndMerge()` — reconcile a semantic collision

In your own app you supply the model call (e.g. an Anthropic API request from a
server route that holds your key). Never ship an API key in client code.

```bash
npm create vite@latest multiplayer-ai -- --template react
cd multiplayer-ai
npm install
# copy src/TwoLayerPoc.jsx into src/, import it in App.jsx
npm run dev
```

---

## Status & honest limitations

This is a **proof of context**, not a production system. It proves the
invariant (fork → diverge → converge → reconcile) on toy-sized state, which is
the point: the merge logic doesn't know or care the state is small, so proving
convergence here proves it at scale — only the materials change.

Known simplifications:

- Layer 1 simulates three replicas via delayed op delivery rather than real
  networked peers. A true multi-peer sync (independent replica states
  exchanging op logs) is the next step.
- The content-address hash is a toy djb2, not SHA — swap for real hashing when
  the DAG persists across sessions.
- Semantic-merge conflict resolution currently defers to the model; richer
  policies (hold-both, weight-by-author-signature, human-arbitrate) are the
  open research surface.
- CRDT deletes are tombstoned but interior editing/cursors aren't fully wired,
  since append-convergence is what proves the property.

---

## License

Licensed under [Creative Commons Attribution 4.0 International (CC BY 4.0)](LICENSE).
You are free to share and adapt this work, including commercially, provided you
give appropriate credit to **Jarett Schadlich**, link to the license, and
indicate any changes.
