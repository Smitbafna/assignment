// ─────────────────────────────────────────────────────────────
// JSON Diff Engine
// Computes diffs between two arbitrary JSON values efficiently.
// Uses recursive comparison with path tracking for large objects.
// ─────────────────────────────────────────────────────────────

export interface DiffChange {
  path: string;
  type: "added" | "removed" | "changed";
  oldValue?: unknown;
  newValue?: unknown;
  oldType?: string;
  newType?: string;
}

export interface DiffResult {
  changes: DiffChange[];
  stats: {
    added: number;
    removed: number;
    changed: number;
  };
}

/**
 * Compute a diff between two JSON values.
 * Uses a recursive comparison that tracks the path of each change.
 * Optimized to handle large objects by skipping deep comparison
 * on arrays with more than 500 elements (treated as atomic).
 */
export function computeDiff(
  oldVal: unknown,
  newVal: unknown,
  basePath = ""
): DiffResult {
  const changes: DiffChange[] = [];

  function compare(a: unknown, b: unknown, path: string) {
    // Same reference or both null/undefined
    if (a === b) return;

    const aType = typeof a;
    const bType = typeof b;
    const aIsNull = a === null;
    const bIsNull = b === null;
    const aIsArray = Array.isArray(a);
    const bIsArray = Array.isArray(b);

    // Different types -> changed
    if (aType !== bType || aIsNull !== bIsNull || aIsArray !== bIsArray) {
      changes.push({
        path,
        type: "changed",
        oldValue: a,
        newValue: b,
        oldType: aIsNull ? "null" : aIsArray ? "array" : aType,
        newType: bIsNull ? "null" : bIsArray ? "array" : bType,
      });
      return;
    }

    // Both are arrays
    if (aIsArray && bIsArray) {
      const arrA = a as unknown[];
      const arrB = b as unknown[];

      // Skip deep comparison for very large arrays - treat as atomic
      if (arrA.length > 500 || arrB.length > 500) {
        if (JSON.stringify(arrA) !== JSON.stringify(arrB)) {
          changes.push({
            path,
            type: "changed",
            oldValue: `[array: ${arrA.length} items]`,
            newValue: `[array: ${arrB.length} items]`,
            oldType: "array",
            newType: "array",
          });
        }
        return;
      }

      const maxLen = Math.max(arrA.length, arrB.length);
      for (let i = 0; i < maxLen; i++) {
        const itemPath = `${path}[${i}]`;
        if (i >= arrA.length) {
          changes.push({
            path: itemPath,
            type: "added",
            newValue: arrB[i],
          });
        } else if (i >= arrB.length) {
          changes.push({
            path: itemPath,
            type: "removed",
            oldValue: arrA[i],
          });
        } else {
          compare(arrA[i], arrB[i], itemPath);
        }
      }
      return;
    }

    // Both are objects (non-null, non-array)
    if (aType === "object" && bType === "object" && !aIsNull && !bIsNull) {
      const objA = a as Record<string, unknown>;
      const objB = b as Record<string, unknown>;

      const allKeys = new Set([...Object.keys(objA), ...Object.keys(objB)]);

      for (const key of allKeys) {
        const keyPath = path ? `${path}.${key}` : key;
        const hasA = key in objA;
        const hasB = key in objB;

        if (!hasA && hasB) {
          changes.push({
            path: keyPath,
            type: "added",
            newValue: objB[key],
          });
        } else if (hasA && !hasB) {
          changes.push({
            path: keyPath,
            type: "removed",
            oldValue: objA[key],
          });
        } else {
          compare(objA[key], objB[key], keyPath);
        }
      }
      return;
    }

    // Primitive values - compare directly
    if (a !== b) {
      changes.push({
        path,
        type: "changed",
        oldValue: a,
        newValue: b,
        oldType: aType,
        newType: bType,
      });
    }
  }

  compare(oldVal, newVal, basePath);

  const stats = {
    added: changes.filter((c) => c.type === "added").length,
    removed: changes.filter((c) => c.type === "removed").length,
    changed: changes.filter((c) => c.type === "changed").length,
  };

  return { changes, stats };
}

/**
 * Format a diff result for display in the context inspector.
 * Returns a tree-like structure with change annotations.
 */
export interface DiffTreeNode {
  key: string;
  value: unknown;
  type: "added" | "removed" | "changed" | "unchanged";
  oldValue?: unknown;
  children?: DiffTreeNode[];
}

export function buildDiffTree(
  oldVal: Record<string, unknown> | null,
  newVal: Record<string, unknown> | null
): DiffTreeNode[] {
  if (!newVal) return [];
  const allKeys = new Set([
    ...(oldVal ? Object.keys(oldVal) : []),
    ...Object.keys(newVal),
  ]);
  const tree: DiffTreeNode[] = [];

  for (const key of allKeys) {
    const hasOld = oldVal && key in oldVal;
    const hasNew = key in newVal;

    if (!hasOld) {
      tree.push({
        key,
        value: newVal[key],
        type: "added",
      });
    } else if (!hasNew) {
      tree.push({
        key,
        value: oldVal![key],
        type: "removed",
      });
    } else {
      const oldV = oldVal![key];
      const newV = newVal[key];
      if (oldV === newV || JSON.stringify(oldV) === JSON.stringify(newV)) {
        tree.push({ key, value: newV, type: "unchanged" });
      } else {
        tree.push({
          key,
          value: newV,
          type: "changed",
          oldValue: oldV,
        });
      }
    }
  }

  return tree.sort((a, b) => a.key.localeCompare(b.key));
}