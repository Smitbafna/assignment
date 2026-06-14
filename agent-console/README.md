# Agent Console

A Next.js application that connects to a mock AI agent backend over WebSockets, renders streaming responses with mid-stream tool call interruptions, displays a live agent trace timeline, and survives the backend's chaos mode without crashing or losing state.

## Architectural Approach

The application uses a **Zustand-based state machine** that drives three interconnected panels: a streaming chat panel that freezes text in-place during tool calls, a real-time protocol event timeline, and a context inspector with JSON diffing. The WebSocket client implements exponential backoff reconnection with seq-based state recovery, and all protocol events are deduplicated and ordered before rendering.

### State Machine Diagram

```
                      ┌──────────┐
                      │   idle    │
                      └────┬─────┘
                           │ connect()
                           ▼
                   ┌───────────────┐
            ┌──────│  connecting   │──────┐
            │      └───────┬───────┘      │
            │              │ onopen       │ error
            │              ▼              │
            │      ┌───────────────┐      │
            │      │  connected    │      │
            │      └───────┬───────┘      │
            │              │              │
            │    ┌─────────┼─────────┐    │
            │    │         │         │    │
            │    ▼         ▼         ▼    │
            │ streaming  tool_call  ping  │
            │            _pending         │
            │    │         │         │    │
            │    └─────────┼─────────┘    │
            │              │              │
            │     onclose (not manual)    │
            │              ▼              │
            │      ┌───────────────┐      │
            └──────│ reconnecting   │──────┘
                   └───────┬───────┘
                           │ exponential backoff
                           │ (500ms → 10s)
                           ▼
                    (back to connecting)

Manual disconnect: connected ──→ disconnected
```

## How to Run

### Prerequisites
- Docker (for the agent server)
- Node.js 20+ and npm

### 1. Start the Agent Server

```bash
cd agent-server
docker build -t agent-server .
docker run -p 4747:4747 agent-server                # normal mode
# or for chaos mode:
docker run -p 4747:4747 agent-server --mode chaos
```

### 2. Start the Agent Console

```bash
cd agent-console
npm install
npm run dev
```

### 3. Open the App

Navigate to [http://localhost:3000](http://localhost:3000)

### 4. Send Messages

Type messages in the chat input. Use trigger keywords from the server README:
- `hello`, `hi`, `hey` — Simple greeting
- `report`, `summary`, `q3` — Report summary with tool call
- `analyze`, `compare` — Multi-tool analysis
- `lookup`, `find`, `search` — Tool call before tokens
- `large`, `schema`, `database` — Large context snapshot
- `long`, `detailed`, `document` — Long response

### 5. View the /log endpoint

```bash
curl http://localhost:4747/log | python3 -m json.tool
```

## Screenshots

### (a) Streamed Response with Tool Call
![Streaming Chat](screenshots/streaming-chat.png)
*The chat panel shows a streamed response interrupted by a tool call card with "waiting" status, then updated with the result.*

### (b) Trace Timeline
![Timeline](screenshots/timeline.png)
*The timeline panel shows every protocol event with color-coded types, token grouping, and a filter/search bar.*

### (c) Context Inspector with Diff
![Context Inspector](screenshots/context-inspector.png)
*The context panel shows snapshot history with a scrubber and diffed tree view showing added/removed/changed keys.*

## Chaos Mode Screen Recording

[Chaos Mode Recording (YouTube/Loom Link - Placeholder)](https://example.com)

The recording demonstrates:
1. Connection drop mid-stream → reconnection → seamless resume
2. Out-of-order message delivery → correct text rendering
3. Rapid tool calls → both cards visible, results land, streaming resumes
4. Oversized context (500KB+) → panel renders without freezing
5. Corrupt heartbeat (empty challenge) → no crash or disconnect