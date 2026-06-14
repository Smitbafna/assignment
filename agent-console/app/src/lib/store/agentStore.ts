// ─────────────────────────────────────────────────────────────
// Central state store using Zustand
// Rationale: Zustand provides a lightweight, performant store
// that works well with WebSocket-driven updates. It avoids the
// boilerplate of Redux while providing fine-grained subscriptions
// to prevent unnecessary re-renders during high-frequency token events.
// ─────────────────────────────────────────────────────────────

import { create } from "zustand";
import type { ServerMessage } from "../../types/protocol";

// ── Types ────────────────────────────────────────────────────

export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface StreamState {
  streamId: string;
  status: "streaming" | "tool_call_pending" | "tool_call_result" | "completed";
  text: string;
  toolCalls: ToolCallState[];
  highlightedToolCall: string | null;
}

export interface ToolCallState {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  result: Record<string, unknown> | null;
  status: "pending" | "acknowledged" | "completed";
}

export interface TimelineEvent {
  id: string;
  seq: number;
  timestamp: number;
  type: ServerMessage["type"];
  data: ServerMessage;
  streamId?: string;
  callId?: string;
  isDuplicate?: boolean;
  isOutOfOrder?: boolean;
}

export interface ContextSnapshotEntry {
  seq: number;
  timestamp: number;
  contextId: string;
  data: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: ToolCallState[];
  streamId?: string;
  status: "streaming" | "complete";
}

interface AgentStore {
  // Connection
  connectionState: ConnectionState;
  reconnectAttempt: number;
  lastProcessedSeq: number;
  receivedSeqs: Set<number>;
  outOfOrderBuffer: ServerMessage[];
  lastResumeSeq: number;

  // Streams
  streams: Map<string, StreamState>;
  activeStreamId: string | null;

  // Chat
  messages: ChatMessage[];
  currentAssistantMessage: ChatMessage | null;
  inputValue: string;

  // Timeline
  timelineEvents: TimelineEvent[];
  timelineFilter: string | null;
  timelineSearch: string;
  timelineHighlightedEvent: string | null;
  groupedTokenEvents: GroupedTokenEvent[];

  // Context
  contextSnapshots: Map<string, ContextSnapshotEntry[]>;
  selectedContextId: string | null;
  scrubberIndex: number;

  // Actions
  setConnectionState: (state: ConnectionState) => void;
  setReconnectAttempt: (attempt: number) => void;
  processMessage: (message: ServerMessage) => void;
  setInputValue: (value: string) => void;
  addUserMessage: (content: string) => void;
  setTimelineFilter: (filter: string | null) => void;
  setTimelineSearch: (search: string) => void;
  setTimelineHighlightedEvent: (id: string | null) => void;
  highlightToolCall: (callId: string) => void;
  setSelectedContextId: (id: string | null) => void;
  setScrubberIndex: (index: number) => void;
  getContextHistory: (contextId: string) => ContextSnapshotEntry[];
  getCurrentContextData: () => Record<string, unknown> | null;
  reset: () => void;
}

let eventCounter = 0;

function generateEventId(): string {
  eventCounter++;
  return `evt_${Date.now()}_${eventCounter}`;
}

let groupCounter = 0;

export interface GroupedTokenEvent {
  id: string;
  startSeq: number;
  endSeq: number;
  count: number;
  durationMs: number;
  fullText: string;
  timestamp: number;
}

function createGroupedTokenEvent(tokens: TimelineEvent[]): GroupedTokenEvent {
  if (tokens.length === 0) {
    return { id: "", startSeq: 0, endSeq: 0, count: 0, durationMs: 0, fullText: "", timestamp: 0 };
  }
  groupCounter++;
  const firstTimestamp = tokens[0].timestamp;
  const lastTimestamp = tokens[tokens.length - 1].timestamp;
  const fullText = tokens
    .map((t) => (t.data as any).text || "")
    .join("");
  return {
    id: `group_${groupCounter}`,
    startSeq: tokens[0].seq,
    endSeq: tokens[tokens.length - 1].seq,
    count: tokens.length,
    durationMs: Math.max(1, lastTimestamp - firstTimestamp),
    fullText,
    timestamp: firstTimestamp,
  };
}

const initialStore: Pick<
  AgentStore,
  | "connectionState"
  | "reconnectAttempt"
  | "lastProcessedSeq"
  | "receivedSeqs"
  | "outOfOrderBuffer"
  | "lastResumeSeq"
  | "streams"
  | "activeStreamId"
  | "messages"
  | "currentAssistantMessage"
  | "inputValue"
  | "timelineEvents"
  | "timelineFilter"
  | "timelineSearch"
  | "timelineHighlightedEvent"
  | "groupedTokenEvents"
  | "contextSnapshots"
  | "selectedContextId"
  | "scrubberIndex"
> = {
  connectionState: "idle",
  reconnectAttempt: 0,
  lastProcessedSeq: 0,
  receivedSeqs: new Set<number>(),
  outOfOrderBuffer: [],
  lastResumeSeq: 0,
  streams: new Map(),
  activeStreamId: null,
  messages: [],
  currentAssistantMessage: null,
  inputValue: "",
  timelineEvents: [],
  timelineFilter: null,
  timelineSearch: "",
  timelineHighlightedEvent: null,
  groupedTokenEvents: [],
  contextSnapshots: new Map(),
  selectedContextId: null,
  scrubberIndex: 0,
};

export const useAgentStore = create<AgentStore>((set, get) => ({
  ...initialStore,

  setConnectionState: (state) => set({ connectionState: state }),

  setReconnectAttempt: (attempt) => set({ reconnectAttempt: attempt }),

  setInputValue: (value) => set({ inputValue: value }),

  addUserMessage: (content) => {
    const message: ChatMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      content,
      toolCalls: [],
      status: "complete",
    };
    set((state) => ({
      messages: [...state.messages, message],
      inputValue: "",
    }));
  },

  setTimelineFilter: (filter) => set({ timelineFilter: filter }),

  setTimelineSearch: (search) => set({ timelineSearch: search }),

  setTimelineHighlightedEvent: (id) =>
    set({ timelineHighlightedEvent: id }),

  highlightToolCall: (callId) => {
    set((state) => {
      const newStreams = new Map(state.streams);
      for (const [sid, stream] of newStreams) {
        newStreams.set(sid, {
          ...stream,
          highlightedToolCall: callId,
        });
      }
      return { streams: newStreams };
    });
  },

  setSelectedContextId: (id) =>
    set({ selectedContextId: id, scrubberIndex: 0 }),

  setScrubberIndex: (index) => set({ scrubberIndex: index }),

  getContextHistory: (contextId) => {
    return get().contextSnapshots.get(contextId) || [];
  },

  getCurrentContextData: () => {
    const { selectedContextId, contextSnapshots, scrubberIndex } = get();
    if (!selectedContextId) return null;
    const history = contextSnapshots.get(selectedContextId);
    if (!history || history.length === 0) return null;
    return history[Math.min(scrubberIndex, history.length - 1)].data;
  },

  reset: () => set(initialStore),

  processMessage: (message) => {
    const state = get();
    const seq = message.seq;

    // ── Deduplication ──────────────────────────────────────
    if (state.receivedSeqs.has(seq)) {
      // Add duplicate flag to timeline
      const event: TimelineEvent = {
        id: generateEventId(),
        seq,
        timestamp: Date.now(),
        type: message.type,
        data: message,
        isDuplicate: true,
      };
      set((s) => ({
        timelineEvents: [...s.timelineEvents, event],
      }));
      return;
    }

    // ── Out-of-order handling ────────────────────────────
    // Check if this message is the next expected seq
    const expectedSeq = state.lastProcessedSeq + 1;
    if (seq < expectedSeq) {
      // Already processed or old message - still log but mark
      const event: TimelineEvent = {
        id: generateEventId(),
        seq,
        timestamp: Date.now(),
        type: message.type,
        data: message,
        isDuplicate: true,
      };
      set((s) => ({
        timelineEvents: [...s.timelineEvents, event],
      }));
      return;
    }

    if (seq > expectedSeq && state.connectionState === "connected") {
      // Out of order in normal mode or chaos mode - buffer it
      const event: TimelineEvent = {
        id: generateEventId(),
        seq,
        timestamp: Date.now(),
        type: message.type,
        data: message,
        isOutOfOrder: true,
      };
      set((s) => ({
        outOfOrderBuffer: [...s.outOfOrderBuffer, message].sort(
          (a, b) => a.seq - b.seq
        ),
        timelineEvents: [...s.timelineEvents, event],
      }));
      return;
    }

    // ── Process message ──────────────────────────────────
    // Actually process it - update received seqs
    const newReceivedSeqs = new Set(state.receivedSeqs);
    newReceivedSeqs.add(seq);
    let newLastProcessedSeq = Math.max(state.lastProcessedSeq, seq);

    const event: TimelineEvent = {
      id: generateEventId(),
      seq,
      timestamp: Date.now(),
      type: message.type,
      data: message,
    };

    let newMessages = [...state.messages];
    let newStreams = new Map(state.streams);
    let newActiveStreamId = state.activeStreamId;
    let newContextSnapshots = new Map(state.contextSnapshots);
    let newGroupedTokenEvents = [...state.groupedTokenEvents];
    let currentAssistantMessage = state.currentAssistantMessage;

    switch (message.type) {
      case "TOKEN": {
        let stream = newStreams.get(message.stream_id);
        if (!stream) {
          stream = {
            streamId: message.stream_id,
            status: "streaming",
            text: "",
            toolCalls: [],
            highlightedToolCall: null,
          };
          newStreams.set(message.stream_id, stream);
        }
        stream = { ...stream, text: stream.text + message.text };
        newStreams.set(message.stream_id, stream);
        newActiveStreamId = message.stream_id;

        // Update current assistant message
        currentAssistantMessage = {
          id: `assistant_${message.stream_id}`,
          role: "assistant",
          content: stream.text,
          toolCalls: stream.toolCalls,
          streamId: message.stream_id,
          status: "streaming",
        };

        // Group token events - accumulate into last group
        const lastGroup = newGroupedTokenEvents[newGroupedTokenEvents.length - 1];
        if (lastGroup && lastGroup.endSeq === seq - 1) {
          // Extend existing group
          newGroupedTokenEvents = [
            ...newGroupedTokenEvents.slice(0, -1),
            createGroupedTokenEvent([
              ...getTokenEventsForGroup(
                state.timelineEvents,
                lastGroup.startSeq,
                lastGroup.endSeq
              ),
              { ...event, id: generateEventId() },
            ]),
          ];
        } else {
          // Start new group
          newGroupedTokenEvents = [
            ...newGroupedTokenEvents,
            createGroupedTokenEvent([event]),
          ];
        }
        break;
      }

      case "TOOL_CALL": {
        const stream = newStreams.get(message.stream_id);
        if (stream) {
          const toolCall: ToolCallState = {
            callId: message.call_id,
            toolName: message.tool_name,
            args: message.args,
            result: null,
            status: "pending" as const,
          };
          stream.toolCalls = [...stream.toolCalls, toolCall];
          stream.status = "tool_call_pending";
          newStreams.set(message.stream_id, stream);

          // Update current assistant message
          currentAssistantMessage = {
            id: `assistant_${message.stream_id}`,
            role: "assistant",
            content: stream.text,
            toolCalls: stream.toolCalls,
            streamId: message.stream_id,
            status: "streaming",
          };
        }
        (event as any).callId = message.call_id;
        break;
      }

      case "TOOL_RESULT": {
        const stream = newStreams.get(message.stream_id);
        if (stream) {
          const toolCalls = stream.toolCalls.map((tc) => {
            if (tc.callId === message.call_id) {
              return {
                ...tc,
                result: message.result,
                status: "completed" as const,
              };
            }
            return tc;
          });
          stream.toolCalls = toolCalls;
          stream.status = "tool_call_result";
          // Check if there are pending tool calls
          const hasPending = toolCalls.some(
            (tc) => tc.status === "pending" || tc.status === "acknowledged"
          );
          if (!hasPending) {
            stream.status = "streaming";
          }
          newStreams.set(message.stream_id, stream);

          // Update current assistant message
          currentAssistantMessage = {
            id: `assistant_${message.stream_id}`,
            role: "assistant",
            content: stream.text,
            toolCalls: stream.toolCalls,
            streamId: message.stream_id,
            status: "streaming",
          };
        }
        (event as any).callId = message.call_id;
        break;
      }

      case "CONTEXT_SNAPSHOT": {
        const snapshot: ContextSnapshotEntry = {
          seq,
          timestamp: Date.now(),
          contextId: message.context_id,
          data: message.data as Record<string, unknown>,
        };
        const existing = newContextSnapshots.get(message.context_id) || [];
        newContextSnapshots.set(message.context_id, [...existing, snapshot]);
        break;
      }

      case "STREAM_END": {
        const stream = newStreams.get(message.stream_id);
        if (stream) {
          stream.status = "completed";
          newStreams.set(message.stream_id, stream);

          // Finalize assistant message
          currentAssistantMessage = {
            id: `assistant_${message.stream_id}`,
            role: "assistant",
            content: stream.text,
            toolCalls: stream.toolCalls,
            streamId: message.stream_id,
            status: "complete" as const,
          };
        }
        break;
      }

      case "ERROR": {
        console.error("Server error:", message.code, message.message);
        break;
      }

      case "PING": {
        // PING is handled by AgentClient directly, but we log it
        break;
      }
    }

    // Update messages - replace or append assistant message
    if (currentAssistantMessage) {
      const existingIdx = newMessages.findIndex(
        (m) => m.streamId === currentAssistantMessage.streamId && m.role === "assistant"
      );
      if (existingIdx >= 0) {
        newMessages[existingIdx] = currentAssistantMessage;
      } else {
        // Find the last user message and append after it
        const lastUserIdx = [...newMessages]
          .reverse()
          .findIndex((m) => m.role === "user");
        if (lastUserIdx >= 0) {
          const insertAt = newMessages.length - lastUserIdx;
          newMessages.splice(insertAt, 0, currentAssistantMessage);
        } else {
          newMessages.push(currentAssistantMessage);
        }
      }
    }

    // Process buffered messages if we can
    const remainingBuffer = [...state.outOfOrderBuffer].filter(
      (m) => m.seq !== seq
    );

    set({
      lastProcessedSeq: newLastProcessedSeq,
      receivedSeqs: newReceivedSeqs,
      outOfOrderBuffer: remainingBuffer,
      streams: newStreams,
      activeStreamId: newActiveStreamId,
      messages: newMessages,
      currentAssistantMessage,
      timelineEvents: [...state.timelineEvents, event],
      groupedTokenEvents: newGroupedTokenEvents,
      contextSnapshots: newContextSnapshots,
    });
  },
}));

function getTokenEventsForGroup(
  events: TimelineEvent[],
  startSeq: number,
  endSeq: number
): TimelineEvent[] {
  return events.filter(
    (e) => e.type === "TOKEN" && e.seq >= startSeq && e.seq <= endSeq
  );
}