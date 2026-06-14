"use client";

// ─────────────────────────────────────────────────────────────
// AgentConsole - Main layout component
// Wires together ChatPanel, TimelinePanel, and ContextInspector
// with the WebSocket AgentClient. Manages panel visibility via
// a resizable/collapsible side panel system.
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAgentStore } from "../lib/store/agentStore";
import { AgentClient } from "../lib/ws/AgentClient";
import { ChatPanel } from "./ChatPanel";
import { TimelinePanel } from "./TimelinePanel";
import { ContextInspector } from "./ContextInspector";

const WS_URL = "ws://localhost:4747/ws";

export function AgentConsole() {
  const clientRef = useRef<AgentClient | null>(null);
  const connectionState = useAgentStore((s) => s.connectionState);
  const reconnectAttempt = useAgentStore((s) => s.reconnectAttempt);
  const setConnectionState = useAgentStore((s) => s.setConnectionState);
  const setReconnectAttempt = useAgentStore((s) => s.setReconnectAttempt);

  // Panel visibility toggles
  const [showTimeline, setShowTimeline] = useState(true);
  const [showContext, setShowContext] = useState(true);

  // Initialize WebSocket client
  useEffect(() => {
    if (clientRef.current) return; // Already initialized

    const client = new AgentClient({
      url: WS_URL,
    });

    clientRef.current = client;

    // Sync connection state
    client.on("stateChange", (state) => {
      setConnectionState(state);
    });

    client.on("reconnectAttempt", (attempt) => {
      setReconnectAttempt(attempt);
    });

    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [setConnectionState, setReconnectAttempt]);

  // Expose client for sending messages from ChatPanel
  const client = clientRef.current;

  const handleReconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      setTimeout(() => clientRef.current?.connect(), 100);
    }
  }, []);

  return (
    <div className="flex flex-col h-screen bg-zinc-50 dark:bg-black">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Agent Console
          </h1>
          <ConnectionStatusBadge
            state={connectionState}
            attempt={reconnectAttempt}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTimeline(!showTimeline)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              showTimeline
                ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500"
            }`}
          >
            Timeline
          </button>
          <button
            onClick={() => setShowContext(!showContext)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              showContext
                ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500"
            }`}
          >
            Context
          </button>
          <button
            onClick={handleReconnect}
            className="px-3 py-1 text-xs font-medium rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            title="Force reconnect"
          >
            ↻
          </button>
        </div>
      </header>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat panel (center) */}
        <div className="flex-1 min-w-0 p-2">
          {client ? (
            <ChatPanel client={client} />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
              Initializing...
            </div>
          )}
        </div>

        {/* Side panels */}
        <div className="flex gap-2 p-2 pr-2">
          {showTimeline && (
            <div className="w-80 shrink-0 overflow-hidden rounded-lg">
              <TimelinePanel />
            </div>
          )}
          {showContext && (
            <div className="w-72 shrink-0 overflow-hidden rounded-lg">
              <ContextInspector />
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <footer className="flex items-center gap-4 px-4 py-1.5 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0">
        <span>
          Connection:{" "}
          <span className="font-medium">{connectionState}</span>
        </span>
        <span>
          Events:{" "}
          <span className="font-medium">
            {useAgentStore.getState().timelineEvents.length}
          </span>
        </span>
        <span>
          Streams:{" "}
          <span className="font-medium">
            {useAgentStore.getState().streams.size}
          </span>
        </span>
        <span className="ml-auto">
          Agent Console v1.0 | Alchemyst AI Assignment
        </span>
      </footer>
    </div>
  );
}

// ── Connection Status Badge ────────────────────────────────────

function ConnectionStatusBadge({
  state,
  attempt,
}: {
  state: string;
  attempt: number;
}) {
  const colorMap: Record<string, string> = {
    idle: "bg-zinc-400",
    connecting: "bg-blue-400 animate-pulse",
    connected: "bg-green-400",
    reconnecting: "bg-amber-400 animate-pulse",
    disconnected: "bg-red-400",
  };

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          colorMap[state] || "bg-zinc-400"
        }`}
      />
      <span className="text-xs text-zinc-500 dark:text-zinc-400 capitalize">
        {state === "reconnecting"
          ? `Reconnecting (${attempt})`
          : state}
      </span>
    </div>
  );
}