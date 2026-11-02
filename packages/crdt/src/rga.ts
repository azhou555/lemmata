/**
 * RGA (Replicated Growable Array): a sequence CRDT for text.
 *
 * Every character gets a globally unique, Lamport-style id. An insert names the
 * character it was typed after (its `origin`). Concurrent inserts after the same
 * origin are ordered by id, so every replica that has seen the same set of ops
 * ends up with the same sequence, regardless of delivery order.
 *
 * Deletes never remove a node; they mark it as a tombstone. That keeps ids
 * stable so later ops can still refer to deleted characters.
 *
 * Delivery model: ops may arrive duplicated, reordered or late. An op whose
 * dependency has not arrived yet (an insert whose origin is missing, a delete
 * whose target is missing) is buffered and retried once the dependency lands.
 *
 * Known simplifications (deliberate, to be replaced as the project grows):
 *  - the sequence is a flat array, so lookups and inserts are O(n)
 *  - no tombstone garbage collection
 */

export type SiteId = string;

/** Globally unique id for an inserted character. */
export interface OpId {
  site: SiteId;
  counter: number;
}

export interface InsertOp {
  kind: "insert";
  id: OpId;
  /** The character this one was typed after (null = start of document). */
  origin: OpId | null;
  char: string;
}

export interface DeleteOp {
  kind: "delete";
  target: OpId;
}

export type Op = InsertOp | DeleteOp;

interface Node {
  id: OpId;
  char: string;
  deleted: boolean;
}

export const idKey = (id: OpId): string => `${id.counter}@${id.site}`;

/** Total order on ids: higher counter is greater, ties broken by site id. */
export function compareIds(a: OpId, b: OpId): number {
  if (a.counter !== b.counter) return a.counter - b.counter;
  return a.site < b.site ? -1 : a.site > b.site ? 1 : 0;
}

export class RGA {
  readonly site: SiteId;

  private clock = 0;
  private nodes: Node[] = [];
  private byKey = new Map<string, Node>();
  private pending: Op[] = [];

  constructor(site: SiteId) {
    this.site = site;
  }

  // ---- local edits: apply immediately, return the op to broadcast ----------

  localInsert(index: number, char: string): InsertOp {
    if (index < 0 || index > this.length) {
      throw new RangeError(`insert index ${index} out of range 0..${this.length}`);
    }
    const origin = index === 0 ? null : this.visibleNode(index - 1).id;
    const op: InsertOp = {
      kind: "insert",
      id: { site: this.site, counter: this.clock + 1 },
      origin,
      char,
    };
    this.integrate(op);
    return op;
  }

  localDelete(index: number): DeleteOp {
    const node = this.visibleNode(index);
    node.deleted = true;
    return { kind: "delete", target: node.id };
  }

  // ---- remote ops: idempotent, order-insensitive ---------------------------

  apply(op: Op): void {
    if (!this.tryApply(op)) {
      this.pending.push(op);
      return;
    }
    this.drainPending();
  }

  // ---- reading -------------------------------------------------------------

  /** Number of visible characters. */
  get length(): number {
    let n = 0;
    for (const node of this.nodes) if (!node.deleted) n++;
    return n;
  }

  text(): string {
    let s = "";
    for (const node of this.nodes) if (!node.deleted) s += node.char;
    return s;
  }

  /** Ops buffered because a dependency has not arrived yet. */
  get pendingCount(): number {
    return this.pending.length;
  }

  get tombstoneCount(): number {
    let n = 0;
    for (const node of this.nodes) if (node.deleted) n++;
    return n;
  }

  /** Full internal order including tombstones; handy for convergence checks. */
  snapshot(): string {
    return this.nodes.map((n) => idKey(n.id) + (n.deleted ? "x" : "")).join(",");
  }

  // ---- internals -----------------------------------------------------------

  /** Returns true if the op was applied (or was a duplicate), false if it must wait. */
  private tryApply(op: Op): boolean {
    if (op.kind === "insert") {
      if (this.byKey.has(idKey(op.id))) return true; // duplicate
      if (op.origin !== null && !this.byKey.has(idKey(op.origin))) return false;
      this.integrate(op);
      return true;
    }
    const node = this.byKey.get(idKey(op.target));
    if (!node) return false;
    node.deleted = true; // idempotent
    return true;
  }

  private drainPending(): void {
    let progressed = true;
    while (progressed && this.pending.length > 0) {
      progressed = false;
      const stillWaiting: Op[] = [];
      for (const op of this.pending) {
        if (this.tryApply(op)) progressed = true;
        else stillWaiting.push(op);
      }
      this.pending = stillWaiting;
    }
  }

  /**
   * Place a new node right after its origin, skipping over any nodes with a
   * greater id. Those are concurrent siblings (or their descendants) that
   * win the tie-break and therefore sit closer to the origin.
   */
  private integrate(op: InsertOp): void {
    this.clock = Math.max(this.clock, op.id.counter);
    let i = op.origin === null ? 0 : this.positionOf(op.origin) + 1;
    while (i < this.nodes.length && compareIds(this.nodes[i].id, op.id) > 0) i++;
    const node: Node = { id: op.id, char: op.char, deleted: false };
    this.nodes.splice(i, 0, node);
    this.byKey.set(idKey(op.id), node);
  }

  private positionOf(id: OpId): number {
    return this.nodes.findIndex(
      (n) => n.id.counter === id.counter && n.id.site === id.site,
    );
  }

  private visibleNode(index: number): Node {
    let seen = 0;
    for (const node of this.nodes) {
      if (node.deleted) continue;
      if (seen === index) return node;
      seen++;
    }
    throw new RangeError(`index ${index} out of range 0..${seen - 1}`);
  }
}
