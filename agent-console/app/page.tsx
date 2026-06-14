"use client";

// ─────────────────────────────────────────────────────────────
// Main page - Renders the Agent Console application
// This is a client component that connects to the agent server
// and provides the streaming chat, timeline, and context panels.
// ─────────────────────────────────────────────────────────────

import { AgentConsole } from "./src/components/AgentConsole";

export default function Home() {
  return <AgentConsole />;
}