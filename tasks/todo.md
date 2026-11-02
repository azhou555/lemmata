# Lemmata learning roadmap

The goal is to understand why each piece works, not just to ship it. These tasks point you at questions and leave the algorithm and design choices to you.

Each task has:
- **Question:** what you need to be able to answer.
- **Explore:** terms and sources to start from. These are topics, not answers.
- **Done when:** how you prove you got there, usually a test, a measurement, or an explanation in your own words.

Habits for every phase:
- [ ] Keep `tasks/decisions.md`: for each design choice, record the options you considered, what you picked, and what would change your mind. It becomes the raw material for the Phase 4 design doc.
- [ ] Predict before you run anything: write down the result you expect, then look at why you were wrong.
- [ ] When a fuzz run finds a bug, keep the seed as a regression test and note what the bug taught you.

## Where things stand (2026-10-30)

- The RGA core exists, and all 10 tests and the typecheck pass. Checked on a scratch copy, so `npm install` still hasn't been run in this folder.
- The private GitHub repo exists at https://github.com/azhou555/lemmata and is the `origin` of the local git repo, but nothing is committed or pushed yet.
- The fuzz suite is weaker than it looks: see the first task in Phase 0.5.

## Phase 0.5: Audit what the tests prove

- [ ] **Install and run the tests yourself, then make the first commit and push it.**
  - Done when: you have a green run on your machine and the first commit is on `main` at https://github.com/azhou555/lemmata.

- [ ] **Find out why the fuzz runs are so short.**
  - Question: `convergence.test.ts` asks for up to 250 actions. In a sample of 2,000 arrays built with the same options, the median length was 5 and the longest was 10. Why? What does `maxLength` actually control?
  - Explore: how fast-check chooses array sizes; `fc.sample` and `fc.statistics`.
  - Done when: the suite really exercises long histories, and you can show the distribution of generated lengths.

- [ ] **Measure how much concurrency the fuzzer creates.**
  - Question: Long histories don't guarantee interesting ones. How often do replicas actually edit concurrently, and how often do inserts share an origin?
  - Explore: coverage measurement for property tests; happens-before.
  - Done when: you have numbers for how often the tricky cases occur, and you've adjusted the generator if they're rare.

- [ ] **Prove the tests can fail.**
  - Question: If you break `integrate` or the tie-break on purpose, which tests notice, and how quickly? Would any bug survive?
  - Explore: mutation testing, by hand or with a tool such as Stryker.
  - Done when: you've tried several deliberate bugs and closed any gaps they exposed.

- [ ] **Explain why RGA converges.**
  - Question: Why does the skip loop in `integrate` produce the same order on every replica, for any delivery order? What does it rely on about counters? What would break if `clock` weren't updated on remote ops?
  - Explore: the original RGA paper (Roh et al., 2011); Lamport clocks; strong eventual consistency (Shapiro et al., 2011).
  - Done when: you can write the argument in your own words, including a worked example with descendants of concurrent siblings.

- [ ] **Decide what the merged text should be.**
  - Question: The "interleaved typing" test only checks `toHaveLength(10)`. Two people typing "hello" and "world": what would a user want to see? Write down your answer, then run it. Then try other scenarios, such as typing backwards or inserting into the middle of someone's run.
  - Explore: interleaving anomalies in collaborative editors (Kleppmann et al., 2019).
  - Done when: you can separate "converges" from "converges to something sensible" and have recorded whether this project should care yet.

## Phase 1: Network simulator and fuzzing

- [ ] **Plan what the simulator has to model.**
  - Question: The last step of `simulate` delivers every op to every replica. What kinds of bug can that design never catch? What should the system guarantee mid-partition, as opposed to after healing?
  - Explore: Jepsen's fault models; deterministic simulation testing (FoundationDB, TigerBeetle); eventual delivery.
  - Done when: you've written a list of faults and, for each one, the invariant it threatens.

- [ ] **Design for replay.**
  - Question: What must be deterministic for a seed to reproduce a whole run? Where could hidden nondeterminism get in? How will you shrink a failure into something readable?
  - Explore: seeded PRNGs; virtual time; fast-check model-based testing and custom shrinking.
  - Done when: rerunning a failing seed gives the identical trace, and you've proved it by comparing traces.

- [ ] **Build `packages/sim` one fault at a time.**
  - Question: Which faults does the CRDT handle by itself, and which need a retransmission layer? What's the difference between a dropped op and a delayed one? If an op is lost for good, what can you still promise, and which replicas can you promise it for? What exactly must happen after a partition heals before you can claim convergence?
  - Done when:
    - Each fault (delay, reorder, duplicate, drop, partition) has its own test and you can explain what each one exercises.
    - Drop has two separate tests with their own invariants: one where the op is lost permanently, and one where it is retransmitted.
    - `decisions.md` records whether a dropped op that was already acknowledged can be recovered, and your convergence guarantee states the delivery conditions it depends on.

- [ ] **Choose your invariants.**
  - Question: Beyond "all replicas match at the end", what should always hold? Think about intention preservation, relative order, and what happens to a replica's own edits.
  - Explore: the strong list specification (Attiya et al., 2016).
  - Done when: invariants are written as properties and checked at thousands of seeds.

- [ ] **Stress the pending buffer.**
  - Question: What happens to `pending` when a dependency never arrives? How large can it grow, and what does `drainPending` cost as it grows? Can duplicates pile up in it?
  - Done when: you've made a prediction, measured it under the simulator, and recorded a decision.

## Phase 2: Sync server and CodeMirror client

- [ ] **Work out the catch-up protocol on paper before adding version vectors.**
  - Question: Walk through a client reconnecting after a partition, using the real op types in `rga.ts`:
    - `DeleteOp` has no id of its own. What identifies a delete, and how would anyone know a client is missing one?
    - Counters come from `clock + 1`, where `clock` follows the highest counter seen from any site, so one site's counters can jump. `apply` also accepts ops out of order. Does "highest counter per site" honestly mean "I have everything up to here"?
  - Explore: version vectors; dotted version vectors; causal delivery; delta sync; Lamport clocks vs per-site sequence numbers.
  - Done when: you have a written design, including any op format changes, and the simulator has tested catch-up with deletes in the missing range.

- [ ] **Decide what "dumb relay" means.**
  - Question: What's the least the server has to understand? What does it need to guarantee before acknowledging an op? What happens if it crashes between persisting and broadcasting? Must every client see ops in the same order?
  - Explore: write-ahead logs; at-least-once delivery and idempotence; WebSocket reconnection and backpressure; SQLite as an op log.
  - Done when: killing the server at random moments under test loses no acknowledged op.

- [ ] **Work out what a site is.**
  - Question: What happens if a tab reloads and reuses its site id with a reset clock? Or if the same document is open in two tabs? What should survive a reload for this to count as local-first?
  - Explore: "Local-first software" (Kleppmann et al., 2019); IndexedDB; replica identity.
  - Done when: you have a test that reproduces the failure, plus a design that prevents it.

- [ ] **Decide what a character is.**
  - Question: `localInsert` takes a `string` per node, and the tests split text with `[...s]`. What unit do CodeMirror's positions count? What happens with an emoji, or a combining accent, on either side of a merge?
  - Explore: UTF-16 code units vs code points vs grapheme clusters; `Intl.Segmenter`.
  - Done when: fuzz tests that include non-ASCII text pass through the editor binding.

- [ ] **Design the CodeMirror binding.**
  - Question: How do you translate between editor positions and CRDT ids in both directions? How do you stop a remote change echoing back out as a local one? What happens to the selection when a remote edit lands? How do you handle a paste of 10,000 characters?
  - Explore: CodeMirror 6 transactions, annotations and `ViewPlugin`s; how `y-codemirror.next` is structured (after you've sketched your own).
  - Done when: two browser tabs can edit offline and merge on reconnect, with the cursor staying where it should.

## Phase 3: Equation blocks and presence

- [ ] **Model an equation inside the document.**
  - Question: How does an atomic block sit in a character sequence? Where does its content live, and how do ops refer to it? Would your choice make the later move to a nested CRDT easy or painful?
  - Explore: embeds in Yjs and Peritext; composing CRDTs.
  - Done when: you've compared at least two sketches in `decisions.md`.

- [ ] **Work through the conflict cases.**
  - Question: For a last-writer-wins register, what does "last" mean without a trusted clock? What should happen if one person deletes an equation while another edits it? What does the losing writer see?
  - Explore: LWW registers vs multi-value registers; add-wins vs remove-wins semantics; Hybrid Logical Clocks.
  - Done when: each conflict case has a chosen behaviour, a reason, and a simulator test.

- [ ] **Design the editing experience around invalid LaTeX.**
  - Question: What should users see while an equation is half-typed or fails to parse? How do you keep rendering from slowing down typing?
  - Explore: KaTeX error handling; CodeMirror block widgets and decorations.
  - Done when: broken LaTeX never breaks the editor, and you've timed render cost on a document with many equations.

- [ ] **Decide whether presence belongs in the CRDT.**
  - Question: Should cursors go through the op log? What should a cursor be anchored to so it survives remote edits? How do you detect that someone has left?
  - Explore: ephemeral vs durable state; the Yjs awareness protocol; heartbeats.
  - Done when: you have live cursors that stay correct during concurrent edits and disappear when someone disconnects.

## Phase 4: Visualizer, benchmarks, and write-up

- [ ] **Work out what the visualizer needs to know.**
  - Question: The visualizer should show which ops were concurrent. Can you tell that from today's op format? If not, what must each op record, and what does that cost per character?
  - Explore: causal graphs; event graphs (Eg-walker, Gentle & Kleppmann); vector clocks vs explicit parent pointers.
  - Done when: someone unfamiliar with CRDTs can look at a conflict in the panel and explain what happened.

- [ ] **Predict performance, then measure it.**
  - Question: Before running anything, estimate the cost of a keystroke and of a full merge at 100k ops. Where does O(n) work stack up across `length`, `visibleNode`, `positionOf`, and `drainPending`? Rank them by how much you expect them to matter.
  - Explore: Node `--cpu-prof` and flame graphs; real editing traces (`josephg/editing-traces`); benchmarking pitfalls.
  - Done when: you have numbers on a real trace, and a note on how your ranking compared and why it differed.

- [ ] **Fix the biggest bottleneck you measured.**
  - Question: What data structure options exist for this bottleneck, and what does each one cost in memory and complexity? Only look at published answers after sketching your own options.
  - Explore: Seph Gentle's "5000x faster CRDTs"; run-length encoding of ops; how Yjs and diamond-types store documents.
  - Done when: a before-and-after benchmark shows the gain, and the convergence suite still passes.

- [ ] **Measure the metadata cost.**
  - Question: How many bytes per character do ids, origins, and tombstones cost, in memory and on the wire? How does that change with a realistic typing pattern versus a worst case?
  - Done when: the "What to measure" items in the README all have real numbers.

- [ ] **Write the design doc and deploy.**
  - Question: Could a reader follow your decisions, the alternatives you rejected, and the evidence for them? What fails first in production that the simulator couldn't show you?
  - Explore: WebSocket hosting options; ARCHITECTURE.md examples from other projects.
  - Done when: the app is live, and the doc is built from `decisions.md` with your real measurements.

## Phase 5: Stretch goals (pick by curiosity)

- [ ] **Tombstone GC.** When is it provably safe to discard a tombstone? What happens if an offline replica returns afterwards? Explore: causal stability; epochs.
- [ ] **Level 2 equations.** What does merging per character do to LaTeX validity? How often does it produce invalid output under fuzzing?
- [ ] **Swap in another sequence algorithm.** Do your interleaving scenarios from Phase 0.5 improve? Could your test suite run unchanged against both? Explore: Fugue ("The Art of the Fugue", Weidner & Kleppmann, 2023).
- [ ] **Natural language to LaTeX.** How should an AI-generated edit enter the op log, and how should it be attributed and undone?
- [ ] **Compare against OT.** Could you explain when you'd choose operational transformation instead of a CRDT? Explore: the Jupiter paper; how Google Docs handles collaboration.

## Review

_Add notes after each phase: what surprised you, what you'd do differently, and which README claims changed._
