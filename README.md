# Multiplayer AI — Proof of Context

### What if AI collaboration worked like Git + Google Docs?

A proof-of-concept architecture for shared AI context where multiple humans and
an AI agent can work simultaneously, branch their reasoning, and reconcile
divergent conclusions — without forcing every edit through an LLM.

CRDTs handle concurrent collaboration. DAG commits preserve provenance and
branching. AI is invoked only when branches contain genuine semantic conflicts.

**[▶ Try the live demo](https://schady4.github.io/multiplayer-ai/)** · [Architecture](#architecture-at-a-glance) · [What's in here](#whats-in-here) · [Run locally](#running-it)

Built by **Jarett Schadlich**.

---

## Architecture at a glance

```
                 ┌─────────────────────┐
                 │   Shared Surface    │
                 │       (CRDT)        │
                 └──────────┬──────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
           Human A        Human B          Claude
              │              │              │
              └──────────────┼──────────────┘
                             │
                        snapshot
                             │
                             ▼
                     ┌───────────────┐
                     │   DAG Ledger  │
                     │  (content-    │
                     │   addressed)  │
                     └───────┬───────┘
                             │
                   ┌─────────┴─────────┐
                   ▼                   ▼
               Branch A             Branch B
                   │                   │
                   └─────────┬─────────┘
                              ▼
                     three-way merge
                              │
                      semantic conflict?
                        /            \
                      no              yes
                       │               │
                    merge         AI arbitration
                (free, no          (single
                 inference)       inference call)
```

Live collaboration converges for free (CRDT). Reasoning history branches and
merges mechanically (DAG). AI is paid for only at genuine semantic collisions.

---

## The problem

Today's AI conversations are fundamentally single-player. One person owns the
context; everyone else gets a read-only transcript, not shared working state.

Multiplayer AI needs:

- multiple humans working simultaneously
- an AI agent contributing to the same context
- divergent lines of reasoning that can branch
- persistent provenance
- deterministic reconciliation where possible
- AI arbitration only where deterministic reconciliation fails

This POC explores one architecture for that.

## The core idea

Don't make the LLM resolve every conflict — use the right mechanism for each
class of change:

| Problem | Mechanism |
|---|---|
| Concurrent edits | CRDT |
| Shared live state | CRDT |
| Branching | DAG |
| Provenance | Content-addressed commits |
| Mechanical merge | Three-way merge |
| Semantic conflict | AI arbitration |

This repository is intentionally small — the goal is to demonstrate the
architectural invariant before introducing production infrastructure.

---

## The architecture, in depth

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
| `src/lib/anthropic.js` | The one place either component talks to Claude — a thin BYOK client for the [live demo](https://schady4.github.io/multiplayer-ai/). |

The two POCs are single-file React components; `App.jsx` just tab-switches between them for the live demo.

---

## Running it

The [live demo](https://schady4.github.io/multiplayer-ai/) is a static Vite +
React build deployed to GitHub Pages via GitHub Actions on every push to
`main`. GitHub Pages can't hold a server-side secret, so the AI seat uses a
**bring-your-own-key** model: you paste your own Anthropic API key into the
banner at the top of the page, it's kept in that tab's `sessionStorage` only
(never persisted, never sent anywhere but directly to Anthropic's API), and
it's gone the moment you close the tab. Without a key, everything except the
Claude seat still works — CRDT typing, forking, and mechanical merges are pure
client-side logic that costs nothing.

To run it locally:

```bash
git clone https://github.com/schady4/multiplayer-ai
cd multiplayer-ai
npm install
npm run dev
```

The two integration seams, if you want to point them at your own backend
instead of calling Anthropic directly from the browser:

- `runBranchTurn()` / `claudeType()` — advance a branch / write to the surface
- `mergeConflict()` / `branchAndMerge()` — reconcile a semantic collision

Both go through `src/lib/anthropic.js`. Swap `callClaude()` for a fetch to
your own server route once you'd rather hold the key server-side than rely on
BYOK.

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
- The live demo's BYOK model means your API key is used directly from the
  browser (with Anthropic's `anthropic-dangerous-direct-browser-access`
  header) rather than proxied through a server. That's the right tradeoff for
  a static demo with no backend, but a production app should hold the key
  server-side instead.

---

## License

Licensed under [Creative Commons Attribution 4.0 International (CC BY 4.0)](LICENSE).
You are free to share and adapt this work, including commercially, provided you
give appropriate credit to **Jarett Schadlich**, link to the license, and
indicate any changes.
