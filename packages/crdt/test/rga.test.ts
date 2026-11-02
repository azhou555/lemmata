import { describe, expect, it } from "vitest";
import { RGA, type Op } from "../src/index";

/** Type a string at the end (or at `at`) and return the ops to broadcast. */
const typeInto = (r: RGA, s: string, at = r.length): Op[] =>
  [...s].map((c, i) => r.localInsert(at + i, c));

const deliver = (r: RGA, ops: Op[]) => ops.forEach((op) => r.apply(op));

describe("local editing", () => {
  it("builds text from inserts and deletes", () => {
    const a = new RGA("a");
    typeInto(a, "hello");
    expect(a.text()).toBe("hello");
    a.localDelete(1);
    expect(a.text()).toBe("hllo");
    a.localInsert(2, "X");
    expect(a.text()).toBe("hlXlo");
  });

  it("rejects out-of-range indices", () => {
    const a = new RGA("a");
    expect(() => a.localInsert(1, "x")).toThrow(RangeError);
    expect(() => a.localDelete(0)).toThrow(RangeError);
  });
});

describe("concurrent edits", () => {
  it("two inserts at the same position converge in both delivery orders", () => {
    const a = new RGA("a");
    const b = new RGA("b");
    deliver(b, typeInto(a, "ac")); // shared starting text "ac"

    const x = a.localInsert(1, "X"); // a: aXc
    const y = b.localInsert(1, "Y"); // b: aYc
    a.apply(y);
    b.apply(x);

    expect(a.text()).toBe(b.text());
    // equal counters, so the higher site id ("b") wins and sits closer to the origin
    expect(a.text()).toBe("aYXc");
    expect(a.snapshot()).toBe(b.snapshot());
  });

  it("an insert after a character survives that character being deleted concurrently", () => {
    const a = new RGA("a");
    const b = new RGA("b");
    deliver(b, typeInto(a, "abc"));

    const del = a.localDelete(1); // a deletes "b"
    const ins = b.localInsert(2, "X"); // b types X right after "b"
    a.apply(ins);
    b.apply(del);

    expect(a.text()).toBe("aXc");
    expect(b.text()).toBe("aXc");
    expect(a.snapshot()).toBe(b.snapshot());
  });

  it("interleaved typing by two sites converges", () => {
    const a = new RGA("a");
    const b = new RGA("b");
    const opsA = typeInto(a, "hello");
    const opsB = typeInto(b, "world");
    deliver(a, opsB);
    deliver(b, opsA);
    expect(a.text()).toBe(b.text());
    expect(a.text()).toHaveLength(10);
  });
});

describe("delivery guarantees", () => {
  it("buffers ops that arrive before their dependencies", () => {
    const a = new RGA("a");
    const b = new RGA("b");
    const ops = typeInto(a, "abc");

    b.apply(ops[2]);
    b.apply(ops[1]);
    expect(b.text()).toBe("");
    expect(b.pendingCount).toBe(2);

    b.apply(ops[0]);
    expect(b.text()).toBe("abc");
    expect(b.pendingCount).toBe(0);
  });

  it("buffers a delete that arrives before its insert", () => {
    const a = new RGA("a");
    const b = new RGA("b");
    const ins = a.localInsert(0, "x");
    const del = a.localDelete(0);

    b.apply(del);
    expect(b.pendingCount).toBe(1);
    b.apply(ins);
    expect(b.text()).toBe("");
    expect(b.pendingCount).toBe(0);
    expect(b.tombstoneCount).toBe(1);
  });

  it("ignores duplicate ops", () => {
    const a = new RGA("a");
    const b = new RGA("b");
    const ops = typeInto(a, "abc");
    ops.push(a.localDelete(1));

    deliver(b, ops);
    deliver(b, ops);
    deliver(b, ops);

    expect(b.text()).toBe("ac");
    expect(b.snapshot()).toBe(a.snapshot());
  });
});
