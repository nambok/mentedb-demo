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

export async function seedPersona(sessionId: string, persona: string): Promise<void> {
  await fetch(`${BASE}/api/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, persona }),
  });
}

export async function getMemories(sessionId: string): Promise<Memory[]> {
  const res = await fetch(`${BASE}/api/memories?session_id=${sessionId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.memories || [];
}
