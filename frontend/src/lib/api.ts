const BASE = '';

export interface ChatRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  session_id: string;
  mode: 'with_memory' | 'without_memory';
}

export interface ChatResponse {
  response: string;
  model: string;
  memories_used: Array<{
    content: string;
    relevance: number;
    type: string;
    is_new?: boolean;
    from_cache?: boolean;
    health?: number;
    scope?: string;
    tags?: string[];
  }>;
  memories_stored: Array<{ content: string; type: string }>;
  contradiction_detected: { old: string; new: string } | null;
  pain_warnings?: Array<{ signal_id?: string; description?: string; intensity?: number }>;
  proactive_recalls?: Array<{ trigger: string; reason: string; memories: Array<{ summary: string }> }>;
  detected_actions?: Array<{ type: string; detail: string }>;
  interference?: Array<{ memory_a: string; memory_b: string; similarity: number; disambiguation: string }>;
  stream_alerts?: Array<{ kind: string; ai_said?: string; stored?: string; summary?: string; old?: string; new?: string }>;
  turn_id: number;
}

export interface Memory {
  id: string;
  content: string;
  memory_type: string;
  tags: string[];
  health: number;
}

export async function sendChat(req: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Chat failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function resetSession(sessionId: string): Promise<void> {
  await fetch(`${BASE}/api/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

export async function seedPersona(sessionId: string, persona: string): Promise<Memory[]> {
  const res = await fetch(`${BASE}/api/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, persona }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.memories || [];
}

export async function getMemories(sessionId: string): Promise<Memory[]> {
  const res = await fetch(`${BASE}/api/memories?session_id=${sessionId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.memories || [];
}

// --- Graph explorer ---

export interface GraphNodeT {
  id: string;
  content: string;
  memory_type: string;
  tags: string[];
  health?: number;
}

export interface GraphEdgeT {
  source: string;
  target: string;
  type: string;
  weight: number;
}

export interface ExploreResponse {
  stored: Array<{ content: string; memory_type: string; id: string | null }>;
  recalled: Array<{ content: string; relevance: number; id: string | null; memory_type?: string }>;
  contradiction: { old: string; new: string } | null;
  interference: Array<{ memory_a: string; memory_b: string; similarity: number; disambiguation: string }>;
  response?: string | null;
  nodes: GraphNodeT[];
  edges: GraphEdgeT[];
}

/** Run arbitrary text through the real engine: extract, store, relate, recall.
 *  Returns the turn's results plus the session's full graph afterward. */
export async function explore(sessionId: string, text: string, turnId: number): Promise<ExploreResponse> {
  const res = await fetch(`${BASE}/api/explore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, text, turn_id: turnId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Explore failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// --- Agent file demo ---

export interface AgentFileRule {
  content: string;
  type: string;
  reason: string;
  score?: number;
}

export interface AgentFileAskResponse {
  answer: string;
  rules: AgentFileRule[];
  mem_tokens: number;
  file_tokens: number;
  model: string;
}

export interface IngestStatus {
  status: 'running' | 'done' | 'failed' | 'unknown';
  report?: {
    candidates?: number;
    stored?: number;
    deduplicated?: number;
    trigger_tagged?: number;
    sections?: number;
    parsed_by?: string;
    error?: string;
  } | null;
}

export async function ingestAgentFile(
  sessionId: string,
  content: string
): Promise<{ job_id: string; file_tokens: number }> {
  const res = await fetch(`${BASE}/api/agent-file/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, content }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Ingest failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function agentFileStatus(jobId: string): Promise<IngestStatus> {
  const res = await fetch(`${BASE}/api/agent-file/status?job_id=${encodeURIComponent(jobId)}`);
  if (!res.ok) return { status: 'unknown' };
  return res.json();
}

export async function askAgentFile(req: {
  session_id: string;
  prompt: string;
  preset?: string;
  file_tokens?: number;
}): Promise<AgentFileAskResponse> {
  const res = await fetch(`${BASE}/api/agent-file/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Ask failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
