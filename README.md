# Lemmata

A local-first, real-time collaborative notes editor where **equations are first-class objects**, built on a **sequence CRDT written from scratch**, with a debug view that shows how concurrent edits merge.

## Status

- [x] Phase 0: RGA core (`packages/crdt/src/rga.ts`)
- [x] Phase 0 tests written (`packages/crdt/test/`)
- [ ] Phase 1: network simulator + convergence fuzzing
- [ ] Phase 2: sync server + CodeMirror client
- [ ] Phase 3: equation blocks + presence
- [ ] Phase 4: merge visualizer, benchmarks, deploy

## Run the tests

```sh
npm install
npm test
npm run typecheck
```

The RGA core was checked with a dependency-free script (unit scenarios plus 3,000 randomized
convergence runs). The vitest / fast-check suite in `packages/crdt/test/` was written alongside it but
has not been run yet, so the first `npm test` is the real check. If something fails, fast-check prints
the seed and a shrunk counterexample.

## Architecture

```
packages/
  crdt/     pure library, no I/O: RGA, ids, op types
  sim/      (Phase 1) network simulator + fuzz harness
  server/   (Phase 2) WebSocket relay + persisted op log
  web/      (Phase 2+) React + CodeMirror 6 + KaTeX client
```

- **CRDT core:** TypeScript, zero dependencies. RGA first; Fugue is a possible later swap to address interleaving.
- **Server:** deliberately dumb relay. Persists the op log; on reconnect a client sends its version vector and gets the ops it is missing.
- **Client:** CodeMirror 6 binding, KaTeX for rendering equations.
- **Visualizer:** a panel fed by the same op log, showing causal history and which ops were concurrent.

## How RGA works here

- Each inserted character has an id `{ site, counter }` (Lamport-style) and an `origin`: the character it was typed after.
- Concurrent inserts after the same origin are ordered by id (higher counter first, ties by site id), so every replica converges.
- Deletes are tombstones, so ids stay valid.
- Ops can arrive duplicated, reordered or late. An op whose dependency has not arrived (insert whose origin is missing, delete whose target is missing) is buffered and retried.

Known simplifications: flat-array sequence (O(n) lookups), no tombstone GC. Both are benchmark targets.

## The key design decision: equations

Scoped in levels; each is shippable on its own.

1. **Atomic blocks.** Each equation has a stable id; its content is a last-writer-wins register. Concurrent edits to one equation: one wins, and the visualizer shows the conflict.
2. **Nested sequence CRDT.** Equation content is its own RGA, so concurrent edits inside one equation merge per character. Merged LaTeX may be invalid; render a fallback and flag it.
3. **Structured (stretch).** A tree of math nodes (fractions, sums, ...). Research-y; fine to skip.

## Roadmap

| Phase | Deliverable | Rough time |
|---|---|---|
| 0 | RGA in one process, unit + property tests | ~1 week |
| 1 | Network simulator (reorder, duplicate, delay, partition) + convergence fuzzing | ~1 week |
| 2 | Server, WebSocket sync, CodeMirror binding, offline edits that merge on reconnect | ~1 week |
| 3 | Equation blocks (Level 1), KaTeX, presence cursors | ~1 week |
| 4 | Visualizer, benchmarks, design doc, deploy | ~1 week |
| 5 | Stretch: Level 2 equations, natural-language-to-LaTeX, tombstone GC | as time allows |

Do Phase 1 before any UI. The convergence tests are what make this credible.

## Next steps

1. `npm install && npm test` and fix anything the first real run turns up.
2. Build `packages/sim`: a seeded network with drop / duplicate / delay / reorder / partition, reusing the `simulate` idea from `convergence.test.ts`.
3. Design and test the catch-up protocol before adding version vectors to `RGA` (needed for server catch-up in Phase 2). The current op format isn't ready for them: deletes have no id of their own, and a site's counters can jump. See [tasks/todo.md](tasks/todo.md).

## Cut list

Auth, permissions, multiple documents beyond a simple list, rich text formatting, a global undo stack.

## What to measure

- Metadata bytes per character
- Merge time on a document with 100k+ operations
- Tombstone growth, and the effect of GC
- Convergence success across N thousand random seeds
