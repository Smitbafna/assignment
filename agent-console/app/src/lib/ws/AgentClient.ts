// ─────────────────────────────────────────────────────────────
// WebSocket Agent Client
// Handles connection lifecycle, heartbeats, reconnection with
// state recovery, and protocol compliance.
// State machine: idle → connecting → connected ↔ reconnecting
//                                        → disconnected
// ─────────────────────────────────────────────────────────────

import type {
  ClientMessage,
  ServerMessage,
  PingMessage,
} from "../../types/protocol";
import { useAgentStore } from "../store/agentStore";

type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

interface AgentClientOptions {
  url: string;
}

type EventHandlers = {
  message: (message: ServerMessage) => void;
  stateChange: (state: ConnectionState) => void;
  reconnectAttempt: (attempt: number) => void;
  error: (error: Event) => void;
};

export class AgentClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private state: ConnectionState = "idle";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyClosed = false;

  // Heartbeat: we respond to server PINGs immediately.
  // The server tracks missed PONGs (3 missed = server closes connection).
  // We DON'T track "missed PONGs" client-side - the challenge timer
  // was causing false positives because it fires when no NEW PING arrives.
  // Fix: simply respond to PINGs, no false tracking needed.

  // Track active challenge to reset timer on new PING
  private challengeTimer: ReturnType<typeof setTimeout> | null = null;
  private currentChallenge: string | null = null;

  // Message buffer for replay processing
  private replayBuffer: ServerMessage[] = [];
  private isReplaying = false;

  private listeners: {
    [K in keyof EventHandlers]: Set<EventHandlers[K]>;
  } = {
    message: new Set(),
    stateChange: new Set(),
    reconnectAttempt: new Set(),
    error: new Set(),
  };

  constructor(options: AgentClientOptions) {
    this.url = options.url;
  }

  // --------------------------------------------------
  // Public API
  // --------------------------------------------------

  connect() {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.manuallyClosed = false;

    this.setState(
      this.reconnectAttempt > 0 ? "reconnecting" : "connecting"
    );

    try {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      ws.onopen = () => {
        const attempt = this.reconnectAttempt;
        this.reconnectAttempt = 0;

        this.setState("connected");

        // RESUME must be first message after reconnect
        const store = useAgentStore.getState();
        const lastSeq = store.lastProcessedSeq;

        if (lastSeq > 0) {
          this.send({
            type: "RESUME",
            last_seq: lastSeq,
          });
          this.isReplaying = true;
          this.replayBuffer = [];
        }

        // Notify
        if (attempt > 0) {
          this.emit("reconnectAttempt", attempt);
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage;

          // Handle heartbeat PING immediately (before store processing)
          if (message.type === "PING") {
            this.handlePing(message);
          }

          // If replaying, buffer messages until resume complete
          if (this.isReplaying) {
            this.replayBuffer.push(message);
            // Process buffered messages in order
            this.processReplayBuffer();
          } else {
            // Forward to store for processing
            const store = useAgentStore.getState();
            store.processMessage(message);
            this.emit("message", message);
          }
        } catch (err) {
          console.error("Failed to parse websocket message", err);
        }
      };

      ws.onerror = (error) => {
        console.warn("WebSocket error:", error);
        this.emit("error", error);
      };

      ws.onclose = (closeEvent) => {
        this.ws = null;
        this.clearChallengeTimer();

        if (this.manuallyClosed) {
          this.setState("disconnected");
          return;
        }

        console.warn(
          `WebSocket closed (code: ${closeEvent.code}). Reconnecting...`
        );
        this.scheduleReconnect();
      };
    } catch (err) {
      console.error("Failed to create WebSocket:", err);
      this.scheduleReconnect();
    }
  }

  disconnect() {
    this.manuallyClosed = true;
    this.isReplaying = false;
    this.replayBuffer = [];

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.clearChallengeTimer();

    this.ws?.close();
    this.ws = null;

    this.setState("disconnected");
  }

  sendUserMessage(content: string) {
    this.send({
      type: "USER_MESSAGE",
      content,
    });
  }

  sendToolAck(callId: string) {
    this.send({
      type: "TOOL_ACK",
      call_id: callId,
    });
  }

  // --------------------------------------------------
  // Events
  // --------------------------------------------------

  on<K extends keyof EventHandlers>(
    event: K,
    handler: EventHandlers[K]
  ) {
    this.listeners[event].add(handler);
  }

  off<K extends keyof EventHandlers>(
    event: K,
    handler: EventHandlers[K]
  ) {
    this.listeners[event].delete(handler);
  }

  getState(): ConnectionState {
    return this.state;
  }

  // --------------------------------------------------
  // Heartbeat Management
  // --------------------------------------------------

  private handlePing(message: PingMessage) {
    const challenge = message.challenge;

    // Clear any previous challenge timer
    this.clearChallengeTimer();

    // Handle corrupt heartbeat (empty challenge)
    if (!challenge || challenge.trim() === "") {
      console.warn("Received corrupt PING with empty challenge");
      // Respond with empty echo - don't crash
      this.send({ type: "PONG", echo: "" });
      return;
    }

    // Store current challenge
    this.currentChallenge = challenge;

    // Send PONG immediately with the challenge echoed back
    this.send({ type: "PONG", echo: challenge });
  }

  private clearChallengeTimer() {
    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer);
      this.challengeTimer = null;
    }
    this.currentChallenge = null;
  }

  // --------------------------------------------------
  // Replay Buffer Processing
  // --------------------------------------------------

  private processReplayBuffer() {
    // Sort buffered messages by seq for ordered processing
    this.replayBuffer.sort((a, b) => a.seq - b.seq);

    // Process only messages that are sequential from lastProcessedSeq
    const store = useAgentStore.getState();
    let nextExpectedSeq = store.lastProcessedSeq + 1;

    let processed = 0;
    for (const msg of this.replayBuffer) {
      if (msg.seq === nextExpectedSeq) {
        store.processMessage(msg);
        this.emit("message", msg);
        nextExpectedSeq++;
        processed++;
      } else if (msg.seq < nextExpectedSeq) {
        // Duplicate - skip
        processed++;
      } else {
        // Gap - stop processing, wait for more messages
        break;
      }
    }

    // Remove processed messages from buffer
    this.replayBuffer.splice(0, processed);

    // If buffer is empty and we've been processing, replay is done
    if (this.replayBuffer.length === 0 && this.isReplaying) {
      this.isReplaying = false;
    }
  }

  // --------------------------------------------------
  // Internal
  // --------------------------------------------------

  private send(message: ClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  private scheduleReconnect() {
    this.reconnectAttempt += 1;

    // Exponential backoff: 500ms, 1s, 2s, 4s, capped at 10s
    const delay = Math.min(
      500 * Math.pow(2, this.reconnectAttempt - 1),
      10_000
    );

    console.log(
      `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`
    );
    this.emit("reconnectAttempt", this.reconnectAttempt);

    // Update store with state
    const store = useAgentStore.getState();
    store.setConnectionState("reconnecting");
    store.setReconnectAttempt(this.reconnectAttempt);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private setState(state: ConnectionState) {
    this.state = state;
    this.emit("stateChange", state);

    // Sync to store
    const store = useAgentStore.getState();
    store.setConnectionState(state);
  }

  private emit<K extends keyof EventHandlers>(
    event: K,
    payload: Parameters<EventHandlers[K]>[0]
  ) {
    this.listeners[event].forEach((listener) => {
      listener(payload as never);
    });
  }
}