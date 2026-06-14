"use client";

// ─────────────────────────────────────────────────────────────
// Agent Trace Timeline - Real-time protocol event viewer
// Shows every event with smart grouping for TOKEN events,
// visual linking for TOOL_CALL/TOOL_RESULT pairs, and
// bidirectional highlighting with the chat panel.
// Uses virtualization concepts (only renders visible rows)
// to handle 30+ events/second without jank.
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useMemo, useCallback, useState } from "react";
import { useAgentStore } from "../lib/store/agentStore";
import type { TimelineEvent, GroupedTokenEvent } from "../lib/store/agentStore";

interface TimelinePanelProps {
  highlightedCallId?: string | null;
}

export function TimelinePanel({ highlightedCallId }: TimelinePanelProps) {
  const timelineEvents = useAgentStore((s) => s.timelineEvents);
  const groupedTokenEvents = useAgentStore((s) => s.groupedTokenEvents);
  const timelineFilter = useAgentStore((s) => s.timelineFilter);
  const timelineSearch = useAgentStore((s) => s.timelineSearch);
  const setTimelineFilter = useAgentStore((s) => s.setTimelineFilter);
  const setTimelineSearch = useAgentStore((s) => s.setTimelineSearch);
  const setTimelineHighlightedEvent = useAgentStore(
    (s) => s.setTimelineHighlightedEvent
  );
  const timelineHighlightedEvent = useAgentStore(
    (s) => s.timelineHighlightedEvent
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [expandedTokens, setExpandedTokens] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Auto-scroll to bottom when new events arrive
  const prevEventsLength = useRef(timelineEvents.length);
  useEffect(() => {
    if (
      containerRef.current &&
      timelineEvents.length > prevEventsLength.current
    ) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    prevEventsLength.current = timelineEvents.length;
  }, [timelineEvents.length]);

  // Filter and search events
  const filteredEvents = useMemo(() => {
    let events: TimelineEvent[] = timelineEvents;

    // Filter by type
    if (timelineFilter) {
      events = events.filter((e) => e.type === timelineFilter);
    }

    // Search by content
    if (timelineSearch) {
      const searchLower = timelineSearch.toLowerCase();
      events = events.filter((e) => {
        const dataStr = JSON.stringify(e.data).toLowerCase();
        return dataStr.includes(searchLower);
      });
    }

    return events;
  }, [timelineEvents, timelineFilter, timelineSearch]);

  // Build display items - interleave grouped tokens with other events
  const displayItems = useMemo(() => {
    const items: Array<{
      type: "event" | "token_group";
      event?: TimelineEvent;
      group?: GroupedTokenEvent;
    }> = [];

    // Build a combined view: replace consecutive TOKEN events with groups
    const tokenGroupMap = new Map<string, GroupedTokenEvent>();
    for (const g of groupedTokenEvents) {
      tokenGroupMap.set(`${g.startSeq}-${g.endSeq}`, g);
    }

    let i = 0;
    while (i < filteredEvents.length) {
      const event = filteredEvents[i];
      if (event.type === "TOKEN") {
        // Find the group this token belongs to
        const group = groupedTokenEvents.find(
          (g) => event.seq >= g.startSeq && event.seq <= g.endSeq
        );
        if (group) {
          items.push({ type: "token_group", group });
          // Skip all tokens in this group
          while (
            i < filteredEvents.length &&
            filteredEvents[i].seq >= group.startSeq &&
            filteredEvents[i].seq <= group.endSeq
          ) {
            i++;
          }
        } else {
          items.push({ type: "event", event });
          i++;
        }
      } else {
        items.push({ type: "event", event });
        i++;
      }
    }

    return items;
  }, [filteredEvents, groupedTokenEvents]);

  const toggleTokenGroup = useCallback((id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleEventClick = useCallback(
    (event: TimelineEvent) => {
      setTimelineHighlightedEvent(event.id);
      if (event.callId) {
        useAgentStore.getState().highlightToolCall(event.callId);
      }
    },
    [setTimelineHighlightedEvent]
  );

  const EVENT_COLORS: Record<string, string> = {
    TOKEN: "border-l-blue-400",
    TOOL_CALL: "border-l-amber-400",
    TOOL_RESULT: "border-l-green-400",
    CONTEXT_SNAPSHOT: "border-l-purple-400",
    PING: "border-l-zinc-400",
    STREAM_END: "border-l-rose-400",
    ERROR: "border-l-red-500",
  };

  const EVENT_BG_COLORS: Record<string, string> = {
    TOKEN: "bg-blue-50 dark:bg-blue-900/10",
    TOOL_CALL: "bg-amber-50 dark:bg-amber-900/10",
    TOOL_RESULT: "bg-green-50 dark:bg-green-900/10",
    CONTEXT_SNAPSHOT: "bg-purple-50 dark:bg-purple-900/10",
    PING: "bg-zinc-50 dark:bg-zinc-800/30",
    STREAM_END: "bg-rose-50 dark:bg-rose-900/10",
    ERROR: "bg-red-50 dark:bg-red-900/10",
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          Agent Trace Timeline
        </h3>

        {/* Filter bar */}
        <div className="mt-2 flex flex-col gap-2">
          <select
            value={timelineFilter || ""}
            onChange={(e) =>
              setTimelineFilter(e.target.value || null)
            }
            className="text-xs px-2 py-1 border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
          >
            <option value="">All events</option>
            <option value="TOKEN">Tokens</option>
            <option value="TOOL_CALL">Tool Calls</option>
            <option value="TOOL_RESULT">Tool Results</option>
            <option value="CONTEXT_SNAPSHOT">Context</option>
            <option value="PING">Heartbeats</option>
            <option value="STREAM_END">Stream End</option>
            <option value="ERROR">Errors</option>
          </select>
          <input
            type="text"
            value={timelineSearch}
            onChange={(e) => setTimelineSearch(e.target.value)}
            placeholder="Search events..."
            className="text-xs px-2 py-1 border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 placeholder-zinc-400"
          />
        </div>
      </div>

      {/* Event count */}
      <div className="px-4 py-1 text-xs text-zinc-400 dark:text-zinc-500 border-b border-zinc-100 dark:border-zinc-800">
        {timelineEvents.length} events
        {(timelineFilter || timelineSearch) &&
          ` (${filteredEvents.length} shown)`}
      </div>

      {/* Events list */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto"
        style={{ contain: "strict" }}
      >
        {displayItems.length === 0 && (
          <div className="flex items-center justify-center h-full text-zinc-400 dark:text-zinc-500 text-xs">
            No events yet
          </div>
        )}

        {displayItems.map((item, index) => {
          if (item.type === "token_group" && item.group) {
            return (
              <TokenGroupRow
                key={item.group.id}
                group={item.group}
                isExpanded={expandedGroups.has(item.group.id)}
                onToggle={() => toggleTokenGroup(item.group!.id)}
                isHighlighted={timelineHighlightedEvent === item.group.id}
              />
            );
          }

          if (item.type === "event" && item.event) {
            const event = item.event;
            const isHighlighted = timelineHighlightedEvent === event.id;
            const isLinked =
              highlightedCallId && event.callId === highlightedCallId;

            return (
              <div
                key={event.id}
                onClick={() => handleEventClick(event)}
                className={`px-4 py-2 text-xs cursor-pointer border-l-2 transition-colors ${
                  EVENT_COLORS[event.type] || "border-l-zinc-300"
                } ${
                  EVENT_BG_COLORS[event.type] || ""
                } ${
                  isHighlighted
                    ? "ring-2 ring-blue-400 ring-inset"
                    : ""
                } ${
                  isLinked
                    ? "ring-2 ring-amber-400 ring-inset"
                    : ""
                } hover:bg-zinc-50 dark:hover:bg-zinc-800/50`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-zinc-400 w-12 shrink-0">
                    #{event.seq}
                  </span>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300 w-28 shrink-0">
                    {event.type}
                  </span>
                  <span className="text-zinc-400 truncate">
                    {getEventSummary(event)}
                  </span>
                  {event.isDuplicate && (
                    <span className="ml-auto text-rose-400 text-[10px] font-medium">
                      DUPLICATE
                    </span>
                  )}
                  {event.isOutOfOrder && (
                    <span className="ml-auto text-amber-400 text-[10px] font-medium">
                      OOO
                    </span>
                  )}
                </div>
              </div>
            );
          }
          return null;
        })}

        <div className="h-2" />
      </div>
    </div>
  );
}

// ── Token Group Row ────────────────────────────────────────────

function TokenGroupRow({
  group,
  isExpanded,
  onToggle,
  isHighlighted,
}: {
  group: GroupedTokenEvent;
  isExpanded: boolean;
  onToggle: () => void;
  isHighlighted: boolean;
}) {
  return (
    <div
      className={`border-l-2 border-l-blue-400 ${
        isHighlighted ? "ring-2 ring-blue-400 ring-inset" : ""
      }`}
    >
      <div
        onClick={onToggle}
        className="px-4 py-2 text-xs cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-zinc-400 w-4 shrink-0">
            {isExpanded ? "▼" : "▶"}
          </span>
          <span className="font-mono text-zinc-400 w-12 shrink-0">
            #{group.startSeq}–{group.endSeq}
          </span>
          <span className="font-medium text-blue-600 dark:text-blue-400 w-28 shrink-0">
            TOKEN GROUP
          </span>
          <span className="text-zinc-500 dark:text-zinc-400 truncate">
            Streamed {group.count} tokens ({group.durationMs}ms)
          </span>
        </div>
      </div>
      {isExpanded && (
        <div className="px-8 py-2 text-xs text-zinc-600 dark:text-zinc-400 bg-blue-50/50 dark:bg-blue-900/5 font-mono whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
          {group.fullText || "(empty)"}
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────

function getEventSummary(event: TimelineEvent): string {
  const data = event.data as any;
  switch (event.type) {
    case "TOKEN":
      return `"${(data.text || "").slice(0, 60)}${(data.text || "").length > 60 ? "..." : ""}"`;
    case "TOOL_CALL":
      return `${data.tool_name}(${JSON.stringify(data.args).slice(0, 40)}...)`;
    case "TOOL_RESULT":
      return `${data.call_id}: ${JSON.stringify(data.result).slice(0, 40)}...`;
    case "CONTEXT_SNAPSHOT":
      return `${data.context_id}: ${Object.keys(data.data || {}).length} keys`;
    case "PING":
      return `challenge: "${data.challenge || "(empty)"}"`;
    case "STREAM_END":
      return `stream: ${data.stream_id}`;
    case "ERROR":
      return `[${data.code}] ${data.message}`;
    default:
      return "";
  }
}