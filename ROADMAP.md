# Roadmap — Multiplayer AI, terminal edition

The web POC proved the invariant (fork → diverge → converge → reconcile) on a
CRDT + DAG substrate. This roadmap takes that substrate off the browser and
into the terminal, where the things multiplayer AI actually needs — MCP,
tool permissions, shell access, model routing — are native instead of
sandboxed away.

The goal: a **downloadable, installable CLI** where friends join a shared chat
session from their own terminals, and AI participants sit in that session as
first-class members — using tools, looping, delegating across models, and
spinning up new instances on request.

---

## The reframing

The chat is not on top of the CRDT + DAG. **The chat *is* the CRDT + DAG.**

- Hosting a room = hosting the DAG session ledger and relaying CRDT ops.
- Every friend's terminal is a **replica** on one shared CRDT surface. That's
  what unifies a friends-list session into a single window that converges even
  under network lag — the same property the web POC demonstrated.
- The **DAG** gives that session its history, its branching threads, and its
  provenance (who — human or which model — contributed what).
- **AI participants are just more replicas** on the same surface. A human seat
  and an AI seat differ only in where their ops originate.

So the existing `TwoLayerPoc` / `DagMergePoc` logic is not a future add-on. It
is the transport model for the chat itself. We port it, we don't replace it.

---

## Architecture

```
   friend A          friend B          AI participant(s)
  (terminal)        (terminal)      (Agent SDK + MCP + tools)
      │                 │                    │
      └── CRDT ops ─────┼──── CRDT ops ──────┘
                        │
                 ┌──────┴───────┐
                 │  Relay/room  │   dumb op-relay; convergence is
                 │   server     │   the CRDT math, not the server
                 └──────┬───────┘
                        │
                 ┌──────┴───────┐
                 │  DAG session │   content-addressed history,
                 │   ledger     │   branching threads, provenance
                 └──────┬───────┘
                        │
                 ┌──────┴───────┐
                 │    Router    │   per-request model/provider choice
                 │ (delegation) │   + delegate-to-new-instance primitive
                 └──────────────┘
```

Five components. The router is the one genuinely new core piece; the CRDT/DAG
is a port; the AI participant is mostly a thin adapter over an existing agent
runtime.

| # | Component | What it is | Leverage |
|---|-----------|------------|----------|
| 1 | **Relay / room server** | The chat backbone. One small self-hostable process; relays CRDT ops and holds the DAG session ledger. | Single-file WebSocket relay. `npx` it, or point at a shared one. |
| 2 | **CRDT surface port** | The web POC's RGA sequence CRDT, extracted from React into a transport-agnostic module the CLI and relay share. | Already written — decouple from the browser. |
| 3 | **DAG session ledger** | Snapshots, branching threads, three-way merge, provenance, AI arbitration on semantic collisions. | Already written — swap toy djb2 hash for real hashing when it persists. |
| 4 | **Terminal client (TUI)** | The friends-window chat. Renders the surface, the thread/DAG view, the participant list, a submit line, and inline permission prompts. | Ink (React-for-terminal) reuses React mental model + component code. |
| 5 | **AI participant** | An agent that joins the room as a replica: reads the surface, replies, loops, uses MCP tools under permission gates, spawns children. | Wrap the Claude Agent SDK — loop, MCP, permission modes, subagents exist today. |
| ★ | **Router** | The switchboard. Every request → `{provider, model}`. Lets an agent delegate a subtask to a freshly spun-up instance on a different model. | New, but small. Multi-model from day one. |

---

## Milestones

### M0 — Extract the substrate _(unblocks everything)_
Pull the CRDT + DAG logic out of the React components into framework-free
modules (`core/crdt`, `core/dag`) with a small test suite proving convergence
headlessly. Nothing new; just decoupling what exists from the browser.

### M1 — Chat backbone
Relay server + a minimal TUI client. Two terminals join a room and see one
converged message stream over CRDT ops. No AI yet. This is the "friends window"
skeleton.

### M2 — First AI participant
One AI seat joins the room as a replica via the Agent SDK. It reads the stream
and replies. MCP tool use behind a permission prompt rendered in the TUI. Loop
so it can keep contributing without being re-prompted each turn.

### M3 — The router
Multi-model / multi-provider selection per request. `route(task) →
{provider, model}`. Delegation primitive: an agent asks the router to spin up a
new instance on a chosen model to own a subtask, and that instance joins the
room as its own participant.

### M4 — DAG threads in chat
Branch a thread inside the session, advance branches independently (human or
AI), merge — mechanical where possible, one arbitration call where a genuine
semantic collision exists. This is the web POC's payoff, now inside live chat.

### M5 — Package & distribute
`npx multiplayer-ai` / global install. Room invite/handle flow, self-host vs.
shared relay, config for keys and MCP servers. Downloadable and installable —
the stated end state.

---

## Deliberately deferred
- Auth / identity beyond a handle + room key (demo trust model first).
- Persistence of the DAG across restarts (needs real hashing — M4+).
- Rich conflict policies (hold-both, weight-by-author, human-arbitrate) — the
  open research surface from the web POC carries forward unchanged.
- Any web-hosted frontend. Not now, by design — the terminal is the product.

---

## Stack
Node + TypeScript throughout, so the existing JS CRDT/DAG logic ports directly
and the TUI (Ink) reuses the React model. Agent SDK (JS) for AI participants.
One language, browser assumptions removed.
