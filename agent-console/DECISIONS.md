# Design Decisions Document

## 1. Seq-Based Ordering and Deduplication

### Approach

I used a **`Set<number>` (`receivedSeqs`)** to track all sequence numbers that have been processed, combined with a **priority queue (sorted array)** for out-of-order buffering.

### Data Structure Choice

**Why a `Set<number>` + sorted array instead of a `Map` or binary heap?**
- The `Set` provides O(1) lookup for deduplication, which is critical since the chaos mode can send duplicate seq values.
- The sorted array approach for out-of-order messages is intentionally simple: chaos mode messages are typically only 2-5 positions out of order, not thousands. A binary heap would add complexity for marginal gain at this scale.
- For the replay buffer during reconnection, I use a separate array that's sorted once after all replay messages arrive, since the server sends them in batch.

### Deduplication Flow

```
1. Message arrives → check receivedSeqs.has(seq)
2. If duplicate → log to timeline (marked DUPLICATE), skip processing
3. If new → check if seq == lastProcessedSeq + 1
   - If in-order → process immediately, update lastProcessedSeq
   - If out-of-order → buffer in sorted array, log to timeline (marked OOO)
4. After each processed message, flush buffer: process all messages with seq == lastProcessedSeq + 1
```

### Edge Cases Tested
- **Empty buffer**: No crash when no messages are buffered.
- **Single element**: Processed correctly.
- **Duplicates**: Detected via `Set.has()` and skipped.
- **Fully reversed sequence**: Buffered and sorted properly.

## 2. Preventing Layout Shift During Tool Call Interruptions

### CSS Strategy

The core technique is **CSS containment** combined with **fixed-positioned tool call cards**.

1. **`contain: layout style`** on the streaming text container: This tells the browser that changes inside this container won't affect the layout of elements outside it. When tool call cards are appended below the text, the text itself does not reflow.

2. **Tool call cards** are rendered as block elements below the text, not inline. They use `overflow-hidden` for their own content changes (result arriving).

3. **The cursor (blinking indicator)** is an absolutely-positioned pseudo-element that does not affect text flow.

4. **No `useEffect`-based text updates**: Text is updated imperatively through Zustand's `set()` which triggers a targeted re-render of only the text node, not the entire message list.

### Why This Works Under Stress

When a `TOOL_CALL` arrives mid-stream:
- The text container freezes at its current height due to `contain: layout`
- A new `ToolCallCard` element is appended below it
- The scroll position is preserved because the card appears below the viewport
- When `TOOL_RESULT` arrives, only the card content updates (no layout shift for the text)

Without containment, each token update would trigger a full layout recalculation of the message list, causing visible jitter.

## 3. Reconnection State Recovery Approach

### Tracked State

The critical insight is that **"processed" and "received" are different concepts**:

| Concept | What it means | How we track it |
|---|---|---|
| **Received** | The WebSocket `onmessage` fired | Transient, not stored |
| **Processed** | The message was consumed by the store and rendered to the DOM | `lastProcessedSeq` in Zustand |

### Recovery Flow

```
1. Connection drops
   → State remains in store (messages, streams, tool cards stay visible)
   → UI shows "Reconnecting..." indicator (within 500ms)

2. Reconnection succeeds (exponential backoff)
   → First message on new connection is RESUME(last_seq)
   → Server replays all events after that seq

3. Replay processing
   → Incoming messages are buffered in replayBuffer
   → Sorted by seq
   → Processed in order through the same processMessage() path
   → Duplicates (already processed) are skipped via receivedSeqs set

4. Tool call mid-drop recovery
   → If tool_call was processed but tool_result wasn't:
   → tool card stays visible with "waiting" status
   → When replayed TOOL_RESULT arrives, it matches by call_id
   → Card updates to show result, streaming resumes
```

### DOM vs Socket Tracking

The `lastProcessedSeq` is updated **after** the store's `processMessage()` completes, not when the socket receives the message. This means if a message is parsed but not yet rendered (due to React batching), the seq is still considered processed. This is slightly optimistic but correct in practice because Zustand's synchronous updates ensure rendering happens before the next event loop tick.

### What Makes This Different from Tutorial Code

Most WebSocket reconnection tutorials:
1. Reconnect but lose unacknowledged messages
2. Reconnect and replay everything, causing duplicates
3. Don't preserve tool call state across disconnections

This implementation:
- Preserves all DOM state across disconnections
- Deduplicates replayed messages
- Maintains tool call cards in their current state (waiting → completed)
- Survives mid-stream drops

## 4. Scaling to 50 Concurrent Agent Streams

If this needed to handle 50 concurrent agent streams on one screen ("operations dashboard"):

### What Would Change

1. **Virtualized rendering**: The current implementation renders all messages and timeline events. At 50 streams × ~200 events each = 10,000 DOM nodes, we'd need windowing (e.g., `react-window` or `@tanstack/virtual`).

2. **Shared WebSocket multiplexing**: Instead of 50 separate WebSocket connections, I'd use a single connection with message routing (each message has a `session_id` field). The server would need to support this.

3. **Stream-level deduplication**: The `receivedSeqs` set would become `Map<session_id, Set<number>>` to track per-stream sequence numbers.

4. **Selective subscriptions**: Zustand's `useStore` with selectors would be used to subscribe only to relevant streams. Currently, the entire store is subscribed by each component, which would cause unnecessary re-renders at scale.

5. **Web Worker for diff computation**: The JSON diff engine would move to a Web Worker to avoid blocking the main thread when processing 50 concurrent context snapshots.

6. **Connection pool manager**: A dedicated manager class would handle the 50 WebSocket connections with a shared heartbeat scheduler and global backoff coordination (to avoid all 50 reconnecting simultaneously).

## 5. Scaling to 100x Longer Responses

If the agent generated full documents (100K+ tokens) instead of chat responses:

### What Would Change

1. **Windowed text rendering**: Instead of rendering all tokens as a single text node, we'd render only the visible portion. The full text would be stored in a buffer (or IndexedDB for persistence) but only ~50 lines would be in the DOM at any time.

2. **Lazy timeline**: The timeline panel would not show every TOKEN event. Instead, it would show aggregated progress indicators (e.g., "25% generated", "50% generated") with the ability to "jump to position" on click.

3. **Streaming to disk**: For truly long responses, we'd stream tokens to IndexedDB (via a SharedArrayBuffer or OPFS) and only keep the latest N tokens in memory for rendering.

4. **Compressed context storage**: Context snapshots in the inspector would use structural sharing (similar to immer) to store only incremental diffs, not full payloads. A 500KB snapshot repeated 10 times = 5MB in memory, which is fine. But a 50MB document repeated 10 times = 500MB, which is not.

5. **Debounced re-rendering**: Currently, every token triggers a store update and re-render. For long documents, we'd batch tokens into 100ms windows and render in chunks.

## Identified Protocol Race Condition

### The TOOL_ACK Timeout Race

The protocol spec says:
> The server waits for TOOL_ACK before sending TOOL_RESULT. If not received within 5 seconds, the server logs a protocol violation and sends the result anyway.

This creates a **race condition**:

```
1. Client receives TOOL_CALL (seq: 5)
2. Client sends TOOL_ACK immediately
3. Server processes TOOL_ACK, sends TOOL_RESULT (seq: 6)
4. BUT: A chaos-mode latency spike delays TOKEN (seq: 4) from arriving
5. Client receives TOOL_RESULT (seq: 6) before TOKEN (seq: 4)
6. The out-of-order buffer handles this, but the tool call card renders before the text above it is complete
```

**Mitigation in this implementation**: The out-of-order buffer delays processing seq: 6 until seq: 4 and 5 arrive. But the tool call card (which was created on seq: 5) is already visible because we rendered it immediately upon receiving TOOL_CALL.

**Proper fix**: The tool call card should not render until all previous seq messages (including the TOKENs that were delayed) have been processed. This would require the tool call card to "wait" in a hidden state until the stream catches up. This is not implemented here but is documented as a known limitation.

## State Management Rationale

**Why Zustand over Redux or useState?**

- **Zustand**: Lightweight (1KB), has built-in selector-based subscriptions to prevent unnecessary re-renders, works outside of React components (important for the WebSocket client which needs to push events from `onmessage` callbacks), and has no boilerplate.
- **Redux**: Would add ~10KB + middleware for WebSocket, with no meaningful benefit since our state is not deeply nested (the store is a flat structure with Maps for streams/timeline/context).
- **`useState` + `useReducer`**: Would cause re-render issues because the WebSocket client needs to call `dispatch` from outside React's tree (the `onmessage` handler). Zustand's external store solves this cleanly.

**Key design constraint met**: The WebSocket client never imports React. It only imports the store (`useAgentStore.getState()`), which works outside the component tree.