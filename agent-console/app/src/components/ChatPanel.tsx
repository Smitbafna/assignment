"use client";

// ─────────────────────────────────────────────────────────────
// Chat Panel - Main streaming chat UI
// Renders messages with incremental token updates, tool call
// interruptions with freeze-in-place behavior, and sends TOOL_ACK.
// Uses virtual list references and CSS containment to prevent
// layout shift during token streaming.
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useCallback } from "react";
import { useAgentStore } from "../lib/store/agentStore";
import type { ToolCallState } from "../lib/store/agentStore";
import type { AgentClient } from "../lib/ws/AgentClient";

interface ChatPanelProps {
  client: AgentClient;
}

export function ChatPanel({ client }: ChatPanelProps) {
  const messages = useAgentStore((s) => s.messages);
  const inputValue = useAgentStore((s) => s.inputValue);
  const setInputValue = useAgentStore((s) => s.setInputValue);
  const addUserMessage = useAgentStore((s) => s.addUserMessage);
  const connectionState = useAgentStore((s) => s.connectionState);
  const streams = useAgentStore((s) => s.streams);
  const highlightToolCall = useAgentStore((s) => s.highlightToolCall);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streams]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = inputValue.trim();
      if (!trimmed || connectionState !== "connected") return;

      addUserMessage(trimmed);
      client.sendUserMessage(trimmed);
    },
    [inputValue, connectionState, addUserMessage, client]
  );

  const isConnected =
    connectionState === "connected";
  const isReconnecting = connectionState === "reconnecting";

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
      {/* Connection status bar */}
      {isReconnecting && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-sm flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          Reconnecting...
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 contain-content">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-zinc-400 dark:text-zinc-500 text-sm">
            Send a message to start the conversation
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === "user"
                  ? "bg-blue-500 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              }`}
            >
              {msg.role === "user" ? (
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              ) : (
                <AssistantMessageContent
                  content={msg.content}
                  toolCalls={msg.toolCalls}
                  status={msg.status}
                  streamId={msg.streamId}
                  client={client}
                  onToolCallClick={highlightToolCall}
                />
              )}
            </div>
          </div>
        ))}

        {/* Active tool calls that arrived mid-stream but aren't finalised yet */}
        <div ref={chatEndRef} />
      </div>

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-zinc-200 dark:border-zinc-700 p-4"
      >
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={
              isConnected
                ? "Type a message..."
                : "Waiting for connection..."
            }
            disabled={!isConnected}
            className="flex-1 px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!isConnected || !inputValue.trim()}
            className="px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Assistant Message Content ──────────────────────────────────

interface AssistantMessageContentProps {
  content: string;
  toolCalls: ToolCallState[];
  status: "streaming" | "complete";
  streamId?: string;
  client: AgentClient;
  onToolCallClick: (callId: string) => void;
}

function AssistantMessageContent({
  content,
  toolCalls,
  status,
  streamId,
  client,
  onToolCallClick,
}: AssistantMessageContentProps) {
  // Send TOOL_ACK for pending tool calls
  useEffect(() => {
    const pending = toolCalls.filter(
      (tc) => tc.status === "pending"
    );
    for (const tc of pending) {
      client.sendToolAck(tc.callId);
      // Update store to mark as acknowledged
      useAgentStore.setState((state) => {
        const newStreams = new Map(state.streams);
        if (streamId) {
          const stream = newStreams.get(streamId);
          if (stream) {
            const updatedCalls = stream.toolCalls.map((call) =>
              call.callId === tc.callId
                ? { ...call, status: "acknowledged" as const }
                : call
            );
            newStreams.set(streamId, {
              ...stream,
              toolCalls: updatedCalls,
            });
          }
        }
        return { streams: newStreams };
      });
    }
  }, [toolCalls, client, streamId]);

  return (
    <div className="space-y-2">
      {/* Streaming text with frozen-in-place behavior */}
      <div
        className="text-sm whitespace-pre-wrap break-words"
        style={{ contain: "layout style" }}
      >
        {content}
        {status === "streaming" && toolCalls.length === 0 && (
          <span className="inline-block w-1.5 h-4 ml-0.5 bg-blue-500 animate-pulse" />
        )}
      </div>

      {/* Tool call cards - rendered after the text that froze */}
      {toolCalls.map((tc) => (
        <ToolCallCard
          key={tc.callId}
          toolCall={tc}
          onClick={() => onToolCallClick(tc.callId)}
        />
      ))}

      {status === "streaming" && toolCalls.length > 0 && (
        <span className="inline-block w-1.5 h-4 ml-0.5 bg-blue-500 animate-pulse" />
      )}
    </div>
  );
}

// ── Tool Call Card ─────────────────────────────────────────────

function ToolCallCard({
  toolCall,
  onClick,
}: {
  toolCall: ToolCallState;
  onClick: () => void;
}) {
  const isPending =
    toolCall.status === "pending" || toolCall.status === "acknowledged";

  return (
    <div
      onClick={onClick}
      className="mt-2 border border-zinc-300 dark:border-zinc-600 rounded-lg overflow-hidden cursor-pointer hover:border-blue-400 transition-colors"
      style={{ contain: "layout style" }}
    >
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
        <span className="text-xs font-mono font-medium text-zinc-500 dark:text-zinc-400 uppercase">
          Tool Call
        </span>
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {toolCall.toolName}
        </span>
        {isPending && (
          <span className="ml-auto text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            waiting...
          </span>
        )}
      </div>

      <div className="px-3 py-2 bg-white dark:bg-zinc-900">
        {/* Arguments */}
        {!isPending && toolCall.args && (
          <div className="mb-2">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Args:
            </span>
            <pre className="mt-1 text-xs font-mono text-zinc-700 dark:text-zinc-300 overflow-x-auto">
              {JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>
        )}

        {/* Result */}
        {toolCall.result && (
          <div>
            <span className="text-xs font-medium text-green-600 dark:text-green-400">
              Result:
            </span>
            <pre className="mt-1 text-xs font-mono text-zinc-700 dark:text-zinc-300 overflow-x-auto">
              {JSON.stringify(toolCall.result, null, 2)}
            </pre>
          </div>
        )}

        {isPending && (
          <div className="text-xs text-zinc-400 dark:text-zinc-500 animate-pulse">
            Awaiting tool result...
          </div>
        )}
      </div>
    </div>
  );
}