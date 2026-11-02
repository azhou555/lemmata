import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RGA, idKey, type Op } from "../src/index";

type Action =
  | { t: "insert"; r: number; pos: number; ch: string }
  | { t: "delete"; r: number; pos: number }
  | { t: "deliver"; to: number; op: number };

const REPLICAS = 3;

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  { weight: 4, arbitrary: fc.record({
    t: fc.constant("insert" as const),
    r: fc.nat(REPLICAS - 1),
    pos: fc.nat(60),
    ch: fc.constantFrom(..."abcdefgh".split("")),
  }) },
  { weight: 2, arbitrary: fc.record({
    t: fc.constant("delete" as const),
    r: fc.nat(REPLICAS - 1),
    pos: fc.nat(60),
  }) },
  { weight: 4, arbitrary: fc.record({
    t: fc.constant("deliver" as const),
    to: fc.nat(REPLICAS - 1),
    op: fc.nat(10_000),
  }) },
);

/** Small deterministic PRNG so a failing run can be replayed from its seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Replicas edit locally and receive random ops mid-run (partial, duplicated,
 * reordered delivery). At the end every replica receives every op in its own
 * random order, with some duplicates, which models eventual delivery.
 */
function simulate(actions: Action[], seed: number) {
  const replicas = Array.from({ length: REPLICAS }, (_, i) => new RGA(`site${i}`));
  const log: Op[] = [];

  for (const a of actions) {
    if (a.t === "insert") {
      const r = replicas[a.r];
      log.push(r.localInsert(a.pos % (r.length + 1), a.ch));
    } else if (a.t === "delete") {
      const r = replicas[a.r];
      if (r.length === 0) continue;
      log.push(r.localDelete(a.pos % r.length));
    } else if (log.length > 0) {
      replicas[a.to].apply(log[a.op % log.length]);
    }
  }

  const everything = [...log, ...log.filter((_, k) => k % 3 === 0)];
  replicas.forEach((r, i) => {
    for (const op of shuffle(everything, seed + i)) r.apply(op);
  });

  return { replicas, log };
}

describe("convergence under reordering, duplication and delay", () => {
  it("all replicas end with identical state", () => {
    fc.assert(
      fc.property(
        fc.array(actionArb, { maxLength: 250 }),
        fc.integer(),
        (actions, seed) => {
          const { replicas } = simulate(actions, seed);
          const [first, ...rest] = replicas;
          for (const r of rest) {
            expect(r.text()).toBe(first.text());
            expect(r.snapshot()).toBe(first.snapshot());
          }
          for (const r of replicas) expect(r.pendingCount).toBe(0);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("never loses or duplicates characters", () => {
    fc.assert(
      fc.property(
        fc.array(actionArb, { maxLength: 250 }),
        fc.integer(),
        (actions, seed) => {
          const { replicas, log } = simulate(actions, seed);
          const inserts = log.filter((op) => op.kind === "insert").length;
          const deleted = new Set(
            log.flatMap((op) => (op.kind === "delete" ? [idKey(op.target)] : [])),
          );
          expect(replicas[0].length).toBe(inserts - deleted.size);
        },
      ),
      { numRuns: 300 },
    );
  });
});
