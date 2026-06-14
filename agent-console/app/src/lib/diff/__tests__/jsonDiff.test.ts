// ─────────────────────────────────────────────────────────────
// Tests for the JSON Diff Engine
// Covers: basic value comparison, nested objects, arrays,
// large array optimization, and edge cases.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { computeDiff, buildDiffTree } from "../jsonDiff";

describe("computeDiff", () => {
  it("detects added keys", () => {
    const old = { a: 1 };
    const fresh = { a: 1, b: 2 };
    const result = computeDiff(old, fresh);
    expect(result.stats.added).toBe(1);
    expect(result.stats.changed).toBe(0);
    expect(result.stats.removed).toBe(0);
    expect(result.changes[0].path).toBe("b");
    expect(result.changes[0].type).toBe("added");
  });

  it("detects removed keys", () => {
    const old = { a: 1, b: 2 };
    const fresh = { a: 1 };
    const result = computeDiff(old, fresh);
    expect(result.stats.removed).toBe(1);
    expect(result.changes[0].path).toBe("b");
    expect(result.changes[0].type).toBe("removed");
  });

  it("detects changed primitive values", () => {
    const old = { a: 1, b: "hello" };
    const fresh = { a: 2, b: "world" };
    const result = computeDiff(old, fresh);
    expect(result.stats.changed).toBe(2);
  });

  it("detects nested object changes", () => {
    const old = { nested: { x: 1, y: 2 } };
    const fresh = { nested: { x: 10, y: 2 } };
    const result = computeDiff(old, fresh);
    expect(result.stats.changed).toBe(1);
    expect(result.changes[0].path).toBe("nested.x");
  });

  it("detects type changes", () => {
    const old = { a: "42" };
    const fresh = { a: 42 };
    const result = computeDiff(old, fresh);
    expect(result.stats.changed).toBe(1);
    expect(result.changes[0].oldType).toBe("string");
    expect(result.changes[0].newType).toBe("number");
  });

  it("handles array changes", () => {
    const old = { arr: [1, 2, 3] };
    const fresh = { arr: [1, 2, 4] };
    const result = computeDiff(old, fresh);
    expect(result.stats.changed).toBe(1);
    expect(result.changes[0].path).toBe("arr[2]");
  });

  it("handles large arrays without deep comparison", () => {
    const old = { arr: new Array(600).fill(1) };
    const fresh = { arr: new Array(600).fill(2) };
    const result = computeDiff(old, fresh);
    // Should treat as atomic change due to size limit
    expect(result.stats.changed).toBe(1);
    expect(result.changes[0].newValue).toContain("array");
  });

  it("returns empty diff for identical objects", () => {
    const obj = { a: 1, b: { c: 2 }, d: [1, 2, 3] };
    const result = computeDiff(obj, JSON.parse(JSON.stringify(obj)));
    expect(result.stats.added).toBe(0);
    expect(result.stats.removed).toBe(0);
    expect(result.stats.changed).toBe(0);
    expect(result.changes.length).toBe(0);
  });

  it("handles null and undefined values", () => {
    const old = { a: null, b: undefined };
    // eslint-disable-next-line no-restricted-syntax
    const fresh = { a: null, b: "defined" };
    const result = computeDiff(old, fresh);
    expect(result.stats.changed).toBe(1);
  });
});

describe("buildDiffTree", () => {
  it("marks added keys", () => {
    const tree = buildDiffTree({ a: 1 }, { a: 1, b: 2 });
    const bNode = tree.find((n) => n.key === "b");
    expect(bNode?.type).toBe("added");
  });

  it("marks removed keys", () => {
    const tree = buildDiffTree({ a: 1, b: 2 }, { a: 1 });
    const bNode = tree.find((n) => n.key === "b");
    expect(bNode?.type).toBe("removed");
  });

  it("marks changed keys with oldValue", () => {
    const tree = buildDiffTree({ a: 1 }, { a: 2 });
    const aNode = tree.find((n) => n.key === "a");
    expect(aNode?.type).toBe("changed");
    expect(aNode?.oldValue).toBe(1);
  });

  it("marks unchanged keys", () => {
    const tree = buildDiffTree({ a: 1 }, { a: 1 });
    const aNode = tree.find((n) => n.key === "a");
    expect(aNode?.type).toBe("unchanged");
  });

  it("sorts keys alphabetically", () => {
    const tree = buildDiffTree({ b: 1, a: 2 }, { b: 1, a: 2 });
    expect(tree[0].key).toBe("a");
    expect(tree[1].key).toBe("b");
  });
});