"use client";

// ─────────────────────────────────────────────────────────────
// Context Inspector - Displays agent context data with diffs
// Shows a syntax-highlighted tree view of context snapshots
// with diff computation between consecutive snapshots.
// Features a history scrubber to step through snapshot versions.
// Handles 500KB+ payloads without freezing via lazy rendering.
// ─────────────────────────────────────────────────────────────

import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { useAgentStore } from "../lib/store/agentStore";
import type { ContextSnapshotEntry } from "../lib/store/agentStore";
import { computeDiff, buildDiffTree } from "../lib/diff/jsonDiff";
import type { DiffTreeNode } from "../lib/diff/jsonDiff";

export function ContextInspector() {
  const contextSnapshots = useAgentStore((s) => s.contextSnapshots);
  const selectedContextId = useAgentStore((s) => s.selectedContextId);
  const setSelectedContextId = useAgentStore((s) => s.setSelectedContextId);
  const scrubberIndex = useAgentStore((s) => s.scrubberIndex);
  const setScrubberIndex = useAgentStore((s) => s.setScrubberIndex);

  // Get all context IDs
  const contextIds = useMemo(
    () => Array.from(contextSnapshots.keys()),
    [contextSnapshots]
  );

  // Get history for selected context
  const history = useMemo(() => {
    if (!selectedContextId) return [];
    return contextSnapshots.get(selectedContextId) || [];
  }, [contextSnapshots, selectedContextId]);

  // Get current snapshot data
  const currentSnapshot = useMemo(() => {
    if (history.length === 0) return null;
    const idx = Math.min(scrubberIndex, history.length - 1);
    return history[idx];
  }, [history, scrubberIndex]);

  // Get previous snapshot for diff
  const previousSnapshot = useMemo(() => {
    if (history.length < 2 || scrubberIndex === 0) return null;
    return history[scrubberIndex - 1];
  }, [history, scrubberIndex]);

  // Compute diff between previous and current
  const diff = useMemo(() => {
    if (!previousSnapshot || !currentSnapshot) return null;
    return computeDiff(
      previousSnapshot.data,
      currentSnapshot.data
    );
  }, [previousSnapshot, currentSnapshot]);

  // Build diff tree for display
  const diffTree = useMemo(() => {
    if (!currentSnapshot) return [];
    const prevData = previousSnapshot?.data || null;
    return buildDiffTree(
      prevData as Record<string, unknown> | null,
      currentSnapshot.data as Record<string, unknown>
    );
  }, [currentSnapshot, previousSnapshot]);

  const handleScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setScrubberIndex(parseInt(e.target.value, 10));
    },
    [setScrubberIndex]
  );

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          Context Inspector
        </h3>

        {/* Context selector */}
        <select
          value={selectedContextId || ""}
          onChange={(e) => setSelectedContextId(e.target.value || null)}
          className="mt-2 w-full text-xs px-2 py-1 border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
        >
          <option value="">Select a context...</option>
          {contextIds.map((id) => {
            const snapshots = contextSnapshots.get(id) || [];
            return (
              <option key={id} value={id}>
                {id} ({snapshots.length} snapshots)
              </option>
            );
          })}
        </select>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" style={{ contain: "strict" }}>
        {!selectedContextId && (
          <div className="flex items-center justify-center h-full text-zinc-400 dark:text-zinc-500 text-xs">
            Select a context to inspect
          </div>
        )}

        {selectedContextId && history.length === 0 && (
          <div className="flex items-center justify-center h-full text-zinc-400 dark:text-zinc-500 text-xs">
            No snapshots available
          </div>
        )}

        {currentSnapshot && (
          <div className="px-4 py-3 space-y-3">
            {/* Snapshot info */}
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-medium">Seq:</span> #{currentSnapshot.seq}
              <span className="mx-2">|</span>
              <span className="font-medium">Snapshot:</span>{" "}
              {scrubberIndex + 1}/{history.length}
            </div>

            {/* Diff stats */}
            {diff && (
              <div className="flex gap-3 text-xs">
                {diff.stats.added > 0 && (
                  <span className="text-green-600 dark:text-green-400">
                    +{diff.stats.added} added
                  </span>
                )}
                {diff.stats.removed > 0 && (
                  <span className="text-red-600 dark:text-red-400">
                    -{diff.stats.removed} removed
                  </span>
                )}
                {diff.stats.changed > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    ~{diff.stats.changed} changed
                  </span>
                )}
                {diff.stats.added === 0 &&
                  diff.stats.removed === 0 &&
                  diff.stats.changed === 0 && (
                    <span className="text-zinc-400">No changes</span>
                  )}
              </div>
            )}

            {/* History scrubber */}
            {history.length > 1 && (
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={history.length - 1}
                  value={scrubberIndex}
                  onChange={handleScrub}
                  className="flex-1 h-1.5 accent-blue-500"
                />
                <span className="text-[10px] text-zinc-400 w-8 text-right">
                  {scrubberIndex + 1}/{history.length}
                </span>
              </div>
            )}

            {/* Previous / Current toggle */}
            <DiffTreeView
              tree={diffTree}
              currentData={currentSnapshot.data as Record<string, unknown>}
              previousData={
                previousSnapshot?.data as Record<string, unknown> | undefined
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Diff Tree View ─────────────────────────────────────────────

function DiffTreeView({
  tree,
  currentData,
  previousData,
  depth = 0,
}: {
  tree: DiffTreeNode[];
  currentData: Record<string, unknown>;
  previousData?: Record<string, unknown>;
  depth?: number;
}) {
  return (
    <div className="space-y-0.5" style={{ contain: "layout style" }}>
      {tree.map((node) => (
        <TreeNodeRow
          key={`${node.key}-${depth}`}
          node={node}
          depth={depth}
        />
      ))}
      {/* Show keys in current but not in diff tree (shouldn't happen but safety) */}
      {Object.keys(currentData)
        .filter((k) => !tree.find((t) => t.key === k))
        .map((k) => (
          <TreeNodeRow
            key={`${k}-${depth}-extra`}
            node={{
              key: k,
              value: currentData[k],
              type: "unchanged",
            }}
            depth={depth}
          />
        ))}
    </div>
  );
}

// ── Tree Node Row ──────────────────────────────────────────────

function TreeNodeRow({
  node,
  depth,
}: {
  node: DiffTreeNode;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2); // Auto-expand first 2 levels
  const isExpandable =
    typeof node.value === "object" &&
    node.value !== null &&
    !Array.isArray(node.value)
      ? Object.keys(node.value as Record<string, unknown>).length > 0
      : Array.isArray(node.value)
      ? (node.value as unknown[]).length > 0
      : false;

  // For large objects (>100 keys), collapse by default
  const isLargeObject =
    typeof node.value === "object" &&
    node.value !== null &&
    !Array.isArray(node.value) &&
    Object.keys(node.value as Record<string, unknown>).length > 100;

  useEffect(() => {
    if (isLargeObject) {
      setExpanded(false);
    }
  }, [isLargeObject]);

  const typeLabel = Array.isArray(node.value)
    ? `Array[${(node.value as unknown[]).length}]`
    : typeof node.value === "object" && node.value !== null
    ? "Object"
    : typeof node.value;

  const colorMap: Record<string, string> = {
    added: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/10",
    removed:
      "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/10 line-through",
    changed:
      "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10",
    unchanged: "text-zinc-700 dark:text-zinc-300",
  };

  return (
    <div>
      <div
        className={`flex items-start gap-1 px-1 py-0.5 text-xs rounded cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
          colorMap[node.type] || ""
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => isExpandable && setExpanded(!expanded)}
      >
        {/* Expand/collapse */}
        {isExpandable && (
          <span className="text-zinc-400 w-3 shrink-0 mt-0.5">
            {expanded ? "▼" : "▶"}
          </span>
        )}
        {!isExpandable && <span className="w-3 shrink-0" />}

        {/* Key */}
        <span className="font-medium text-zinc-600 dark:text-zinc-400 shrink-0">
          {node.key}
        </span>

        {/* Separator */}
        <span className="text-zinc-400 mx-1">:</span>

        {/* Value */}
        {isExpandable ? (
          <span className="text-zinc-400 dark:text-zinc-500 italic">
            {typeLabel}
            {node.type === "added" && (
              <span className="ml-1 text-green-500 not-italic font-medium">
                (new)
              </span>
            )}
            {node.type === "changed" && (
              <span className="ml-1 text-amber-500 not-italic font-medium">
                (modified)
              </span>
            )}
          </span>
        ) : (
          <span className="font-mono truncate max-w-[200px] inline-block">
            {formatPrimitiveValue(node.value)}
          </span>
        )}

        {/* Old value indicator for changed */}
        {node.type === "changed" && !isExpandable && (
          <span className="text-zinc-400 text-[10px] ml-1 line-through truncate max-w-[100px]">
            {formatPrimitiveValue(node.oldValue)}
          </span>
        )}
      </div>

      {/* Children */}
      {expanded && isExpandable && (
        <NestedTreeView value={node.value} depth={depth + 1} type={node.type} />
      )}
    </div>
  );
}

// ── Nested Tree View ───────────────────────────────────────────

function NestedTreeView({
  value,
  depth,
  type,
}: {
  value: unknown;
  depth: number;
  type: string;
}) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    const colorClass =
      type === "added"
        ? "text-green-600 dark:text-green-400"
        : type === "changed"
        ? "text-amber-600 dark:text-amber-400"
        : type === "removed"
        ? "text-red-600 dark:text-red-400 line-through"
        : "text-zinc-700 dark:text-zinc-300";

    return (
      <div>
        {entries.map(([k, v]) => (
          <NestedValueRow
            key={k}
            keyName={k}
            value={v}
            depth={depth}
            colorClass={colorClass}
          />
        ))}
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div>
        {value.map((item, idx) => (
          <NestedValueRow
            key={idx}
            keyName={`[${idx}]`}
            value={item}
            depth={depth}
          />
        ))}
      </div>
    );
  }

  return null;
}

// ── Nested Value Row ───────────────────────────────────────────

function NestedValueRow({
  keyName,
  value,
  depth,
  colorClass,
}: {
  keyName: string;
  value: unknown;
  depth: number;
  colorClass?: string;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isExpandable =
    typeof value === "object" && value !== null;

  const isLargeObject =
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length > 100;

  useEffect(() => {
    if (isLargeObject) setExpanded(false);
  }, [isLargeObject]);

  const typeLabel = Array.isArray(value)
    ? `Array[${(value as unknown[]).length}]`
    : typeof value === "object" && value !== null
    ? "Object"
    : null;

  return (
    <div>
      <div
        className={`flex items-start gap-1 px-1 py-0.5 text-xs rounded cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${colorClass || "text-zinc-700 dark:text-zinc-300"}`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => isExpandable && setExpanded(!expanded)}
      >
        {isExpandable && (
          <span className="text-zinc-400 w-3 shrink-0 mt-0.5">
            {expanded ? "▼" : "▶"}
          </span>
        )}
        {!isExpandable && <span className="w-3 shrink-0" />}

        <span className="font-medium text-zinc-500 dark:text-zinc-400 shrink-0">
          {keyName}
        </span>
        <span className="text-zinc-400 mx-1">:</span>

        {isExpandable ? (
          <span className="text-zinc-400 dark:text-zinc-500 italic">
            {typeLabel}
          </span>
        ) : (
          <span className="font-mono truncate max-w-[200px] inline-block">
            {formatPrimitiveValue(value)}
          </span>
        )}
      </div>

      {expanded && isExpandable && (
        <NestedTreeView value={value} depth={depth + 1} type="unchanged" />
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────

function formatPrimitiveValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    if (value.length > 100) return `"${value.slice(0, 100)}..."`;
    return `"${value}"`;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[${value.length} items]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return "{}";
    return `{${keys.length} keys}`;
  }
  return String(value);
}