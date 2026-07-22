import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  DynamoDBClient,
  UpdateItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatRequest {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  session_id: string;
  mode: "with_memory" | "without_memory";
}

interface ResetRequest {
  session_id: string;
}

interface SeedRequest {
  session_id: string;
  persona: "developer" | "student" | "pm";
}

interface MemoryContext {
  content: string;
  relevance_score?: number;
  memory_type?: string;
  tags?: string[];
  is_new?: boolean;
  from_cache?: boolean;
  same_project?: boolean;
  health?: number;
  scope?: string;
}

interface LambdaFunctionUrlEvent {
  requestContext: {
    http: { method: string; path: string; sourceIp: string };
    timeEpoch: number;
  };
  headers: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// ---------------------------------------------------------------------------
// Secrets cache (cold-start singleton)
// ---------------------------------------------------------------------------

interface Secrets {
  MENTEDB_API_KEY: string;
  MENTEDB_API_URL: string;
}

let cachedSecrets: Secrets | null = null;

const smClient = new SecretsManagerClient({});
const ddbClient = new DynamoDBClient({});
const bedrockClient = new BedrockRuntimeClient({ region: "us-east-1" });

async function getSecrets(): Promise<Secrets> {
  if (cachedSecrets) return cachedSecrets;

  const secretArn = process.env.SECRET_ARN;
  if (!secretArn) throw new Error("SECRET_ARN env var not set");

  const resp = await smClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );
  if (!resp.SecretString) throw new Error("Secret value is empty");

  cachedSecrets = JSON.parse(resp.SecretString) as Secrets;
  return cachedSecrets;
}

// ---------------------------------------------------------------------------
// CORS / origin helpers
// ---------------------------------------------------------------------------

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";
const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE ?? "mentedb-demo-rate-limits";
const MAX_REQUESTS_PER_HOUR = 500;

function corsHeaders(origin?: string): Record<string, string> {
  const allowed =
    ALLOWED_ORIGIN === "*"
      ? "*"
      : origin && ALLOWED_ORIGIN.split(",").includes(origin)
        ? origin
        : ALLOWED_ORIGIN.split(",")[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
  };
}

function respond(
  statusCode: number,
  body: unknown,
  origin?: string
): LambdaResponse {
  return {
    statusCode,
    headers: corsHeaders(origin),
    body: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// Rate limiting (DynamoDB)
// ---------------------------------------------------------------------------

async function checkRateLimit(ip: string): Promise<boolean> {
  const key = `ip#${ip}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = nowSec - 3600;
  const ttl = nowSec + 3600;

  // Atomic increment; creates item if missing
  try {
    const result = await ddbClient.send(
      new UpdateItemCommand({
        TableName: RATE_LIMIT_TABLE,
        Key: { pk: { S: key } },
        UpdateExpression:
          "SET #cnt = if_not_exists(#cnt, :zero) + :one, #ttl = :ttl, #win = if_not_exists(#win, :win)",
        ConditionExpression:
          "attribute_not_exists(#win) OR #win >= :windowStart",
        ExpressionAttributeNames: {
          "#cnt": "request_count",
          "#ttl": "ttl",
          "#win": "window_start",
        },
        ExpressionAttributeValues: {
          ":zero": { N: "0" },
          ":one": { N: "1" },
          ":ttl": { N: String(ttl) },
          ":win": { N: String(nowSec) },
          ":windowStart": { N: String(windowStart) },
        },
        ReturnValues: "ALL_NEW",
      })
    );

    const count = parseInt(
      result.Attributes?.request_count?.N ?? "0",
      10
    );
    return count <= MAX_REQUESTS_PER_HOUR;
  } catch {
    // If the window expired, reset and allow
    await ddbClient.send(
      new UpdateItemCommand({
        TableName: RATE_LIMIT_TABLE,
        Key: { pk: { S: key } },
        UpdateExpression:
          "SET #cnt = :one, #ttl = :ttl, #win = :win",
        ExpressionAttributeNames: {
          "#cnt": "request_count",
          "#ttl": "ttl",
          "#win": "window_start",
        },
        ExpressionAttributeValues: {
          ":one": { N: "1" },
          ":ttl": { N: String(ttl) },
          ":win": { N: String(nowSec) },
        },
      })
    );
    return true;
  }
}

// ---------------------------------------------------------------------------
// MenteDB helpers
// ---------------------------------------------------------------------------

import { createHash } from "crypto";

// Deterministic agent id per demo session: with agent scoped retrieval on
// the platform, each browser session only recalls its own memories plus
// shared ones, so visitors stop seeing each other's test data.
function agentIdFor(sessionId: string): string {
  const h = createHash("sha1").update(`mentedb-demo:${sessionId}`).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    "5" + h.slice(13, 16),
    ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + h.slice(18, 20),
    h.slice(20, 32),
  ].join("-");
}

async function mentedbToolCall(
  secrets: Secrets,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const resp = await fetch(`${secrets.MENTEDB_API_URL}/mcp/v1/tools/call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secrets.MENTEDB_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: toolName, arguments: args }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`MenteDB ${toolName} failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as {
    content?: Array<{ type: string; text: string }>;
  };

  // MCP tool responses wrap result in content[0].text as a JSON string
  const textContent = data.content?.find((c) => c.type === "text");
  if (textContent) {
    try {
      return JSON.parse(textContent.text);
    } catch {
      return textContent.text;
    }
  }
  return data;
}

async function mentedbRestGet(
  secrets: Secrets,
  path: string
): Promise<unknown> {
  const resp = await fetch(`${secrets.MENTEDB_API_URL}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secrets.MENTEDB_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`MenteDB GET ${path} failed (${resp.status}): ${text}`);
  }

  return resp.json();
}

// ---------------------------------------------------------------------------
// Bedrock (Amazon Nova Lite) helper
// ---------------------------------------------------------------------------

const BEDROCK_MODEL_ID = "amazon.nova-lite-v1:0";
const BEDROCK_MODEL_DISPLAY = "Amazon Nova Lite";

async function callBedrock(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const payload = {
    system: [{ text: systemPrompt }],
    messages: messages.map((m) => ({
      role: m.role,
      content: [{ text: m.content }],
    })),
    inferenceConfig: {
      maxTokens: 1024,
    },
  };

  const command = new InvokeModelCommand({
    modelId: BEDROCK_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: new TextEncoder().encode(JSON.stringify(payload)),
  });

  const response = await bedrockClient.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.body)) as {
    output: { message: { content: Array<{ text?: string }> } };
  };

  return (
    (result.output?.message?.content ?? [])
      .map((b) => b.text ?? "")
      .join("") || ""
  );
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

// Recall can surface several near-identical episodic turns (the demo gets
// replayed on the same session, and cleanup is capped), which made the activity
// feed show the same memory many times over. Collapse by trimmed content so the
// feed and the prompt show each memory once.
function dedupeByContent<T extends { content?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = (item.content ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// Significant words of a fact, dropping filler so paraphrases of the same thing
// share a token set. "User is building a SaaS app called TaskPilot..." and
// "TaskPilot is a SaaS app being built..." both reduce to {taskpilot, saas, ...}.
function significantTokens(s: string): Set<string> {
  const stop = new Set([
    "user", "is", "are", "was", "the", "a", "an", "of", "to", "for", "with",
    "and", "as", "in", "on", "at", "by", "building", "build", "built", "builds",
    "being", "use", "uses", "using", "used", "prefer", "prefers", "preferred",
    "app", "called", "their", "them", "they", "primary", "that", "this", "over",
    "due", "its", "has", "have", "stack", "tech",
  ]);
  return new Set(
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !stop.has(t))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Collapse near-duplicate facts (paraphrases) that exact-content dedupe misses,
// by significant-token overlap. Keeps the first of each near-duplicate cluster
// so the feed shows one memory per fact instead of five phrasings of it.
function dedupeSimilar<T extends { content?: string; summary?: string }>(
  items: T[],
  threshold = 0.5
): T[] {
  const kept: Array<{ item: T; tokens: Set<string> }> = [];
  for (const item of items) {
    const tokens = significantTokens(item.content ?? item.summary ?? "");
    if (!tokens.size) {
      kept.push({ item, tokens });
      continue;
    }
    if (kept.some((k) => k.tokens.size > 0 && jaccard(k.tokens, tokens) >= threshold)) {
      continue;
    }
    kept.push({ item, tokens });
  }
  return kept.map((k) => k.item);
}

async function handleChat(
  body: ChatRequest,
  secrets: Secrets
): Promise<LambdaResponse & { _origin?: string }> {
  const { messages, session_id, mode } = body;

  if (!messages?.length || !session_id || !mode) {
    return respond(400, { error: "Missing required fields: messages, session_id, mode" });
  }

  const lastUserMsg =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const turnId = messages.filter((m) => m.role === "user").length;

  let memoriesUsed: MemoryContext[] = [];
  let memoriesStored: Array<{ content: string; memory_type?: string; type?: string }> = [];
  let contradictionDetected: { old: string; new: string } | null = null;
  let painWarnings: Array<{ signal_id?: string; description?: string; intensity?: number }> = [];
  let proactiveRecalls: Array<{ trigger: string; reason: string; memories: Array<{ summary: string }> }> = [];
  let detectedActions: Array<{ type: string; detail: string }> = [];
  let interference: Array<{ memory_a: string; memory_b: string; similarity: number; disambiguation: string }> = [];
  let streamAlerts: Array<{ kind: string; ai_said?: string; stored?: string; summary?: string; old?: string; new?: string }> = [];
  let systemPrompt: string;

  if (mode === "with_memory") {
    // 1. Call process_turn to recall + store — gracefully degrade if MenteDB is down
    let turnResult: {
      context?: MemoryContext[];
      contradictions?: number;
      contradiction_details?: Array<{ old_content: string; new_content: string }>;
      pain_warnings?: Array<{ signal_id?: string; description?: string; intensity?: number }>;
      memories_stored?: Array<{ content: string; memory_type: string }>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      proactive_recalls?: Array<any>;
      detected_actions?: Array<{ type: string; detail: string }>;
      interference?: Array<{ memory_a: string; memory_b: string; similarity: number; disambiguation: string }>;
      stream_alerts?: Array<{ kind: string; ai_said?: string; stored?: string; summary?: string; old?: string; new?: string }>;
      stored?: number;
    } = {};

    // Trailing-turn pattern: this call stores the previous exchange (last
    // user message pairs with the assistant reply it produced) and recalls
    // context for the new message. One process_turn per turn, half the
    // latency and storage of the old call-before-and-after design.
    const prevAssistantMsg =
      [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
    try {
      turnResult = (await mentedbToolCall(secrets, "process_turn", {
        user_message: lastUserMsg,
        assistant_response: prevAssistantMsg.slice(0, 500),
        turn_id: turnId,
        project_context: `demo-${session_id}`,
        agent_id: agentIdFor(session_id),
      })) as typeof turnResult;
    } catch (err) {
      console.error("process_turn failed, falling back to no-memory mode:", err);
    }

    memoriesUsed = dedupeByContent(Array.isArray(turnResult.context) ? turnResult.context : []);
    const contradictions = Array.isArray(turnResult.contradiction_details) ? turnResult.contradiction_details : [];
    painWarnings = Array.isArray(turnResult.pain_warnings) ? turnResult.pain_warnings : [];
    memoriesStored = dedupeSimilar(
      dedupeByContent(Array.isArray(turnResult.memories_stored) ? turnResult.memories_stored : [])
    );
    // MenteDB returns { action_type, content, memory_id, relevance } — map to frontend shape
    // Collapse near-duplicate recalls so the same fact is not surfaced several
    // times, then map. The reason is a trigger label, not the fact itself, so the
    // fact shows once as the bullet instead of twice (header + bullet).
    const rawRecalls = dedupeSimilar(
      Array.isArray(turnResult.proactive_recalls) ? turnResult.proactive_recalls : []
    );
    proactiveRecalls = rawRecalls.map((r: { action_type?: string; content?: string; memory_id?: string; relevance?: number; trigger?: string; reason?: string; memories?: Array<{ summary: string }> }) => {
      if (r.trigger && r.reason) return r as { trigger: string; reason: string; memories: Array<{ summary: string }> };
      const fact = (r.content ?? '').split('\n')[0].replace(/^User:\s*/, '').slice(0, 200);
      return {
        trigger: r.action_type ?? 'recall',
        reason: 'Recalled for this reply',
        memories: [{ summary: fact }],
      };
    });
    detectedActions = (Array.isArray(turnResult.detected_actions) ? turnResult.detected_actions : [])
      .filter((a) => a.type && a.type.trim().length > 0);
    // Two cognitive signals the pipeline already returns but the demo dropped:
    // interference (retrieved memories that compete, with disambiguation) and
    // stream alerts (where the assistant's reply contradicts/corrects a stored fact).
    interference = Array.isArray(turnResult.interference) ? turnResult.interference : [];
    streamAlerts = Array.isArray(turnResult.stream_alerts) ? turnResult.stream_alerts : [];
    if (contradictions.length > 0) {
      contradictionDetected = {
        old: contradictions[0].old_content,
        new: contradictions[0].new_content,
      };
    }

    // 2. Build memory-augmented system prompt
    const memoriesFormatted =
      memoriesUsed.length > 0
        ? memoriesUsed
            .map(
              (m, i) =>
                `${i + 1}. [${m.memory_type ?? "memory"}] ${m.content}`
            )
            .join("\n")
        : "No prior memories found for this session.";

    const painContext = painWarnings.length > 0
      ? `\n\n⚠️ Pain signals:\n${painWarnings.map(p => typeof p === 'string' ? p : (p.description ?? '')).join("\n")}`
      : "";

    const proactiveContext = proactiveRecalls.length > 0
      ? `\n\n🔮 Related context:\n${proactiveRecalls.map(r => (r.memories ?? []).map(m => m.summary).join("; ")).join("\n")}`
      : "";

    const contradictionContext = contradictionDetected
      ? `\n\n⚡ Contradiction detected: "${contradictionDetected.old}" → "${contradictionDetected.new}". Acknowledge this change.`
      : "";

    systemPrompt = [
      "You are a helpful AI assistant with persistent memory powered by MenteDB.",
      "You remember previous conversations and preferences.",
      "",
      "IMPORTANT: Keep responses concise (2-4 short paragraphs max).",
      "Do NOT output long code blocks or step-by-step setup guides unless explicitly asked.",
      "Use markdown formatting: **bold** for emphasis, bullet points for lists, `inline code` for technical terms.",
      "",
      "Recalled memories:",
      memoriesFormatted,
      painContext,
      proactiveContext,
      contradictionContext,
      "",
      "Use these memories naturally in your responses.",
      "Reference relevant context without being awkward about it.",
      "If a contradiction was detected, acknowledge the change naturally.",
    ].join("\n");
  } else {
    systemPrompt = [
      "You are a helpful AI assistant.",
      "",
      "IMPORTANT: Keep responses concise (2-4 short paragraphs max).",
      "Do NOT output long code blocks or step-by-step setup guides unless explicitly asked.",
      "Use markdown formatting: **bold** for emphasis, bullet points for lists, `inline code` for technical terms.",
    ].join("\n");
  }

  // 3. Call Bedrock
  const responseText = await callBedrock(
    systemPrompt,
    messages
  );

  return respond(200, {
    response: responseText,
    model: BEDROCK_MODEL_DISPLAY,
    memories_used: memoriesUsed.map((m) => ({
      content: m.content ?? "",
      relevance: m.relevance_score ?? null,
      type: m.memory_type ?? "unknown",
      is_new: m.is_new ?? false,
      from_cache: m.from_cache ?? false,
      health: m.health ?? 1,
      scope: m.scope ?? "contextual",
      tags: m.tags ?? [],
    })),
    memories_stored: memoriesStored.map((m) => ({
      content: m.content ?? "",
      type: m.memory_type ?? m.type ?? "unknown",
    })),
    contradiction_detected: contradictionDetected,
    pain_warnings: painWarnings.map(p => typeof p === 'string' ? { description: p } : p),
    proactive_recalls: proactiveRecalls,
    detected_actions: detectedActions,
    interference,
    stream_alerts: streamAlerts,
    turn_id: turnId,
    mode,
  });
}

async function handleReset(
  body: ResetRequest,
  _secrets: Secrets
): Promise<LambdaResponse> {
  const { session_id } = body;
  if (!session_id) {
    return respond(400, { error: "Missing session_id" });
  }

  // No-op: each browser session uses its own project_context (demo-{session_id})
  // so memories are already isolated. No need to delete globally.
  return respond(200, { ok: true });
}

async function handleMemories(
  queryParams: Record<string, string | undefined> | undefined,
  secrets: Secrets
): Promise<LambdaResponse> {
  const sessionId = queryParams?.["session_id"];
  if (!sessionId) {
    return respond(400, { error: "Missing session_id query parameter" });
  }

  try {
    const limit = Math.min(parseInt(queryParams?.["limit"] ?? "50", 10) || 50, 100);
    const cursor = queryParams?.["cursor"] ?? "";
    const search = queryParams?.["search"] ?? "";

    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (cursor) params.set("cursor", cursor);
    if (search) params.set("search", search);
    // Scope the feed to this browser session's memories, matching how they
    // are stored; without this the feed showed every session's memories.
    params.set("agent_id", agentIdFor(sessionId));

    const result = (await mentedbRestGet(secrets, `/api/memories?${params.toString()}`)) as {
      memories?: Array<{ memory_id?: string; id?: string; content?: string }>;
      [k: string]: unknown;
    };
    // The engine extracts near-identical paraphrases across turns; collapse
    // them for display so the feed reads as distinct facts. Normalize the
    // platform's memory_id to the id the frontend keys on.
    const raw = Array.isArray(result.memories) ? result.memories : [];
    const memories = dedupeSimilar(
      raw.map((m) => ({ ...m, id: m.memory_id ?? m.id })),
      0.6
    );
    return respond(200, { ...result, memories });
  } catch (err) {
    console.error("Memories fetch error:", err);
    return respond(500, { error: "Failed to fetch memories" });
  }
}

// ---------------------------------------------------------------------------
// Graph explorer: one call that ingests arbitrary text through the real engine
// and returns everything the animation needs: what was extracted and stored,
// what was recalled, and the session's live knowledge graph (nodes + typed
// edges) after the turn.
// ---------------------------------------------------------------------------

interface GraphNode {
  id: string;
  content: string;
  memory_type: string;
  tags: string[];
  health?: number;
}

interface ExploreEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}

// Seeds for the SHARED graph explorer space: neutral, third-person facts (a
// communal graph is nobody's first person), written to interlink with each
// other and with the explorer's suggestion chips so relationships form fast.
const GRAPH_SEEDS: Array<{ content: string; memory_type: string; tags: string[] }> = [
  { content: "The team deploys every Friday afternoon and Sarah reviews each release", memory_type: "procedural", tags: ["team", "deploys"] },
  { content: "TaskPilot is a sample SaaS project built with Next.js and Postgres", memory_type: "semantic", tags: ["taskpilot", "stack"] },
  { content: "TaskPilot moved from MongoDB to Postgres for relational queries", memory_type: "correction", tags: ["taskpilot", "database"] },
  { content: "Max is a golden retriever who is allergic to chicken", memory_type: "semantic", tags: ["pets"] },
  { content: "Standup happens at 9:30 on Tuesdays in the Denver office", memory_type: "semantic", tags: ["team", "schedule"] },
  { content: "The Denver office opened in March and hosts the platform team", memory_type: "semantic", tags: ["offices"] },
  { content: "The staging environment runs in eu-west-1 behind a feature flag", memory_type: "semantic", tags: ["infra"] },
  { content: "The design system pairs an emerald accent with dark zinc surfaces", memory_type: "semantic", tags: ["design"] },
];

async function handleExplore(
  body: { session_id?: string; text?: string; turn_id?: number },
  secrets: Secrets
): Promise<LambdaResponse> {
  const { session_id, text } = body;
  if (!session_id) {
    return respond(400, { error: "Missing session_id" });
  }
  if (text && text.length > 600) {
    return respond(400, { error: "Text too long (max 600 characters)" });
  }

  const agentId = agentIdFor(session_id);
  const project = `demo-${session_id}`;

  // 1. Run the text through the real pipeline: extraction, dedup,
  // contradiction detection, storage, and recall, in one engine call.
  // With no text this is a fetch-only call: skip the turn and just return
  // the session's current graph (the explorer's initial load).
  let turn: {
    context?: Array<{ id?: string; content?: string; relevance_score?: number; memory_type?: string }>;
    memories_stored?: Array<{ content: string; memory_type: string }>;
    contradiction_details?: Array<{ old_content: string; new_content: string }>;
    interference?: Array<{ memory_a: string; memory_b: string; similarity: number; disambiguation: string }>;
    proactive_recalls?: Array<{ content?: string; relevance?: number; memory_id?: string }>;
  } = {};
  if (text && text.trim()) {
    try {
      turn = (await mentedbToolCall(secrets, "process_turn", {
        user_message: text.trim(),
        assistant_response: "",
        turn_id: body.turn_id ?? 1,
        project_context: project,
        agent_id: agentId,
      })) as typeof turn;
    } catch (err) {
      console.error("explore process_turn failed:", err);
      return respond(502, { error: "Memory engine unavailable" });
    }
  }

  // 2. The session's graph after the turn: this space's memories only
  // (agent scoped), raw turn captures excluded so the graph shows facts.
  // The shared explorer space self-seeds when found empty (first visitor
  // after the nightly reset), so the graph always has something to relate to.
  // The platform lists memories with a memory_id field; normalize to the id
  // the graph client keys nodes by, and drop anything without one. An
  // undefined id here is what made force-graph collapse every node into one.
  const listNodes = async (): Promise<GraphNode[]> => {
    const listed = (await mentedbRestGet(
      secrets,
      `/api/memories?agent_id=${agentId}&exclude_tag=turn&limit=200`
    )) as {
      memories?: Array<{
        memory_id?: string;
        id?: string;
        content?: string;
        memory_type?: string;
        tags?: string[];
        health?: number;
      }>;
    };
    const raw = Array.isArray(listed.memories) ? listed.memories : [];
    const seen = new Set<string>();
    const out: GraphNode[] = [];
    for (const m of raw) {
      const id = m.memory_id ?? m.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        content: m.content ?? "",
        memory_type: m.memory_type ?? "semantic",
        tags: Array.isArray(m.tags) ? m.tags : [],
        health: m.health,
      });
    }
    return out;
  };
  let nodes: GraphNode[] = [];
  try {
    nodes = await listNodes();
    if (nodes.length === 0 && (!text || !text.trim())) {
      const seeds = GRAPH_SEEDS;
      await mentedbToolCall(secrets, "store_memories", {
        agent_id: agentId,
        memories: seeds.map((mem) => ({
          content: mem.content,
          memory_type: mem.memory_type,
          tags: [...mem.tags, `project:${project}`],
        })),
      });
      nodes = await listNodes();
    }
  } catch (err) {
    console.error("explore memory list failed:", err);
  }
  const nodeIds = new Set(nodes.map((n) => n.id));
  const byContent = new Map(nodes.map((n) => [n.content.trim(), n.id]));

  // 3. Resolve the ids of what this turn stored and recalled, so the client
  // can animate exactly those nodes. Context items carry real memory ids and
  // relevance_score from the engine; content matching is only the fallback.
  const storedRaw = Array.isArray(turn.memories_stored) ? turn.memories_stored : [];
  const stored = storedRaw.map((m) => ({
    content: m.content,
    memory_type: m.memory_type,
    id: byContent.get(m.content.trim()) ?? null,
  }));
  const recalledRaw = dedupeByContent(
    (Array.isArray(turn.context) ? turn.context : []) as Array<{
      id?: string;
      content: string;
      memory_type?: string;
      relevance_score?: number;
    }>
  );
  const recalled = recalledRaw.slice(0, 8).map((m) => ({
    content: m.content,
    memory_type: m.memory_type ?? "semantic",
    relevance: m.relevance_score ?? 0,
    id: m.id ?? byContent.get((m.content ?? "").trim()) ?? null,
  }));
  // Recall reaches shared/global memories that live outside this space's
  // listing; add them as real nodes so the graph can highlight what the
  // engine actually recalled instead of silently dropping it.
  for (const r of recalled) {
    if (r.id && !nodeIds.has(r.id)) {
      nodeIds.add(r.id);
      nodes.push({
        id: r.id,
        content: r.content,
        memory_type: r.memory_type,
        tags: [],
      });
    }
  }

  // 4. Typed edges around the memories this turn touched. Depth 1 per focus
  // node, a handful of parallel lookups, edges filtered to this session's
  // nodes so nothing leaks across sessions.
  const focusIds = [
    ...stored.map((s) => s.id),
    ...recalled.map((r) => r.id),
  ].filter((id): id is string => !!id);
  // Fetch-only load (no turn): sample a random rotation of nodes so repeated
  // polls progressively discover the whole space's edges instead of always
  // fetching the same few neighborhoods. The client accumulates edges, so
  // coverage converges within a few polls.
  const sample = [...nodes]
    .sort(() => Math.random() - 0.5)
    .slice(0, 8)
    .map((n) => n.id);
  const uniqueFocus = [
    ...new Set(focusIds.length > 0 ? [...focusIds, ...sample] : sample),
  ].slice(0, 8);
  const edgeKey = (e: ExploreEdge) => `${e.source}|${e.target}|${e.type}`;
  const edges = new Map<string, ExploreEdge>();
  await Promise.allSettled(
    uniqueFocus.map(async (id) => {
      const hood = (await mentedbRestGet(
        secrets,
        `/api/graph/neighborhood?id=${encodeURIComponent(id)}&depth=1`
      )) as { edges?: Array<{ source: string; target: string; type: string; weight: number }> };
      for (const e of hood.edges ?? []) {
        if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
          const edge: ExploreEdge = { source: e.source, target: e.target, type: e.type, weight: e.weight };
          edges.set(edgeKey(edge), edge);
        }
      }
    })
  );

  // 5. A short grounded reply, so visitors see the brain AND the voice. Uses
  // the recalled memories as context; degrades to null if the model is down.
  let response: string | null = null;
  if (text && text.trim()) {
    try {
      const memoryContext =
        recalled.length > 0
          ? `You remember these facts about this shared space:\n${recalled
              .map((r) => `- ${r.content}`)
              .join("\n")}`
          : "You have no relevant memories yet.";
      const contradictionNote =
        Array.isArray(turn.contradiction_details) && turn.contradiction_details.length > 0
          ? `This turn REPLACED an older fact: "${turn.contradiction_details[0].old_content}" is now superseded by "${turn.contradiction_details[0].new_content}".`
          : "";
      const raw = await callBedrock(
        [
          "You are the voice of a live memory-graph demo. Reply in EXACTLY ONE short sentence,",
          "20 words maximum, conversational and specific.",
          "HARD RULES:",
          "- Use ONLY the remembered facts below. Quote their real values verbatim.",
          "- If the facts do not contain what was asked, say plainly you have not learned that",
          "  yet. NEVER guess, NEVER fabricate, NEVER write placeholder text or brackets.",
          "- Older values that were corrected are replaced, not kept: if asked about a previous",
          "  value that is not in the facts, say you only keep the corrected version and give",
          "  the current value.",
          "- No markdown, no lists, no preamble.",
          memoryContext,
          contradictionNote,
        ].join("\n"),
        [{ role: "user", content: text.trim() }]
      );
      // Keep it snappy no matter what the model does: first sentence, capped.
      const first = raw.split(/(?<=[.!?])\s+/)[0] ?? raw;
      response = first.length > 180 ? `${first.slice(0, 179)}…` : first;
    } catch (err) {
      console.error("explore reply generation failed:", err);
    }
  }

  // Similarity edges: the engine's typed edges accumulate asynchronously and
  // sparsely, so on their own most memories would look like orphans. Compute
  // honest lexical-similarity links (jaccard over significant tokens, top 3
  // per node) so every memory visibly maps to its kin; typed engine edges
  // take precedence on the same pair.
  const pairKey = (a: string, b: string) => (a < b ? `${a}~${b}` : `${b}~${a}`);
  const typedPairs = new Set([...edges.values()].map((e) => pairKey(e.source, e.target)));
  const tokenSets = nodes.map((n) => ({ id: n.id, tokens: significantTokens(n.content) }));
  const candidates: Array<{ a: string; b: string; sim: number }> = [];
  for (let i = 0; i < tokenSets.length; i++) {
    for (let j = i + 1; j < tokenSets.length; j++) {
      const A = tokenSets[i];
      const B = tokenSets[j];
      if (!A.tokens.size || !B.tokens.size) continue;
      const sim = jaccard(A.tokens, B.tokens);
      if (sim >= 0.22 && !typedPairs.has(pairKey(A.id, B.id))) {
        candidates.push({ a: A.id, b: B.id, sim });
      }
    }
  }
  candidates.sort((x, y) => y.sim - x.sim);
  const perNode = new Map<string, number>();
  for (const c of candidates) {
    const ca = perNode.get(c.a) ?? 0;
    const cb = perNode.get(c.b) ?? 0;
    if (ca >= 3 || cb >= 3) continue;
    perNode.set(c.a, ca + 1);
    perNode.set(c.b, cb + 1);
    const edge: ExploreEdge = { source: c.a, target: c.b, type: "similar", weight: c.sim };
    edges.set(edgeKey(edge), edge);
  }

  const contradictions = Array.isArray(turn.contradiction_details) ? turn.contradiction_details : [];
  return respond(200, {
    stored,
    recalled,
    contradiction: contradictions.length > 0
      ? { old: contradictions[0].old_content, new: contradictions[0].new_content }
      : null,
    interference: Array.isArray(turn.interference) ? turn.interference : [],
    response,
    nodes,
    edges: [...edges.values()],
  });
}

// ---------------------------------------------------------------------------
// Seed persona memories
// ---------------------------------------------------------------------------

const PERSONAS: Record<string, Array<{ content: string; memory_type: string; tags: string[] }>> = {
  developer: [
    {
      content: "I use MongoDB and Express.js for my backend projects",
      memory_type: "semantic",
      tags: ["preference", "tech-stack"],
    },
    {
      content: "I prefer TypeScript over JavaScript for all new projects",
      memory_type: "semantic",
      tags: ["preference", "language"],
    },
    {
      content:
        "I'm building an e-commerce platform with product listings, cart, and Stripe checkout",
      memory_type: "semantic",
      tags: ["project", "e-commerce"],
    },
    {
      content: "I use VS Code with vim keybindings and the GitHub Dark theme",
      memory_type: "semantic",
      tags: ["preference", "editor"],
    },
    {
      content: "I deploy to AWS using Docker containers on ECS Fargate",
      memory_type: "procedural",
      tags: ["deployment", "aws"],
    },
    {
      content:
        "Last time I used Firebase it was terrible — the billing was unpredictable and queries were limited",
      memory_type: "anti_pattern",
      tags: ["pain", "firebase"],
    },
  ],
  student: [
    {
      content:
        "I'm a CS student studying machine learning and neural networks",
      memory_type: "semantic",
      tags: ["education", "ml"],
    },
    {
      content: "I use Python and Jupyter notebooks for all my coursework",
      memory_type: "semantic",
      tags: ["preference", "tools"],
    },
    {
      content: "My thesis project is on transformer attention mechanisms",
      memory_type: "semantic",
      tags: ["project", "research"],
    },
    {
      content:
        "I prefer PyTorch over TensorFlow — the debugging is much easier",
      memory_type: "semantic",
      tags: ["preference", "framework"],
    },
    {
      content: "I use a MacBook Pro and develop in VS Code",
      memory_type: "semantic",
      tags: ["preference", "hardware"],
    },
    {
      content:
        "I had a bad experience with Google Colab — kept disconnecting during long training runs",
      memory_type: "anti_pattern",
      tags: ["pain", "colab"],
    },
  ],
  pm: [
    {
      content: "I manage a B2B SaaS product for HR analytics",
      memory_type: "semantic",
      tags: ["project", "product"],
    },
    {
      content:
        "We use Agile with 2-week sprints and Jira for tracking",
      memory_type: "procedural",
      tags: ["process", "agile"],
    },
    {
      content:
        "Our tech stack is React frontend, Node.js backend, PostgreSQL database",
      memory_type: "semantic",
      tags: ["tech-stack"],
    },
    {
      content:
        "We're targeting enterprise customers with 500+ employees",
      memory_type: "semantic",
      tags: ["business", "target-market"],
    },
    {
      content: "I use Figma for wireframes and Amplitude for analytics",
      memory_type: "semantic",
      tags: ["tools"],
    },
    {
      content:
        "We tried Mixpanel before and the pricing model was confusing — switched to Amplitude",
      memory_type: "anti_pattern",
      tags: ["pain", "analytics"],
    },
  ],
};

async function handleSeed(
  body: SeedRequest,
  secrets: Secrets
): Promise<LambdaResponse> {
  const { session_id, persona } = body;

  if (!session_id || !persona) {
    return respond(400, { error: "Missing session_id or persona" });
  }

  const memories = PERSONAS[persona];
  if (!memories) {
    return respond(400, {
      error: `Invalid persona: ${persona}. Must be one of: developer, student, pm`,
    });
  }

  const project = `demo-${session_id}`;

  // One batched call: the per user write lock serialized individual stores
  // server side, so eight parallel store_memory calls took about 18 seconds.
  let seeded = 0;
  try {
    const result = (await mentedbToolCall(secrets, "store_memories", {
      agent_id: agentIdFor(session_id),
      memories: memories.map((mem) => ({
        content: mem.content,
        memory_type: mem.memory_type,
        tags: [...mem.tags, `project:${project}`],
      })),
    })) as { stored?: number };
    seeded = result.stored ?? memories.length;
  } catch (err) {
    console.error("Batch seed failed:", err);
  }
  const results: PromiseSettledResult<unknown>[] = [];
  results
    .filter((r) => r.status === "rejected")
    .forEach((r) => console.error("Failed to seed memory:", (r as PromiseRejectedResult).reason));

  // Fire-and-forget process_turn so it doesn't block the response. Must carry
  // agent_id: without it the turn is stored nil-owned, which is globally
  // visible to every session and leaks across the demo's per-session
  // isolation (a fresh visitor would recall this seed turn).
  mentedbToolCall(secrets, "process_turn", {
    user_message: `[system] Persona initialized: ${persona}`,
    assistant_response: "",
    turn_id: 0,
    project_context: project,
    agent_id: agentIdFor(session_id),
  }).catch((err) => console.error("process_turn for seed project failed:", err));

  return respond(200, { ok: true, seeded, memories: memories.map((m, i) => ({
    id: `seed-${i}`,
    content: m.content,
    memory_type: m.memory_type,
    tags: m.tags,
    health: 1.0,
  }))});
}

// ---------------------------------------------------------------------------
// Main Lambda handler
// ---------------------------------------------------------------------------

// Demo memories are ephemeral showcase data. Anything older than the retention
// window is trimmed on a schedule so the account can never accumulate into a
// recall flood (the pinned/nil-owned pile that made the demo show 40+ duplicate
// ALWAYS memories). Longer than any real session, so active visitors are never
// disrupted.
const RETENTION_HOURS = 3;
const CLEANUP_MAX_PER_RUN = 3000;

async function runDemoCleanup(secrets: Secrets): Promise<number> {
  const cutoffMicros = (Date.now() - RETENTION_HOURS * 3600 * 1000) * 1000;
  const toDelete: string[] = [];
  let cursor = "";
  for (let i = 0; i < 80 && toDelete.length < CLEANUP_MAX_PER_RUN; i++) {
    const url = `${secrets.MENTEDB_API_URL}/api/memories?limit=100${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
    }`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${secrets.MENTEDB_API_KEY}` },
    });
    if (!resp.ok) break;
    const data = (await resp.json()) as {
      memories?: Array<{ memory_id: string; created_at: string }>;
      next_cursor?: string;
    };
    const mems = data.memories ?? [];
    if (!mems.length) break;
    for (const m of mems) {
      if (Number(m.created_at) < cutoffMicros) toDelete.push(m.memory_id);
    }
    cursor = data.next_cursor ?? "";
    if (!cursor) break;
  }
  let deleted = 0;
  const concurrency = 10;
  for (let i = 0; i < toDelete.length; i += concurrency) {
    const batch = toDelete.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (id) => {
        try {
          await mentedbToolCall(secrets, "forget_memory", {
            id,
            reason: "demo retention cleanup",
          });
          deleted++;
        } catch {
          // best effort; the next scheduled run retries the rest
        }
      })
    );
  }
  return deleted;
}

export const handler = async (
  event: LambdaFunctionUrlEvent
): Promise<LambdaResponse> => {
  // Scheduled EventBridge trigger: run retention cleanup, not an HTTP request.
  if ((event as unknown as { source?: string }).source === "aws.events") {
    try {
      const secrets = await getSecrets();
      const deleted = await runDemoCleanup(secrets);
      console.log(`demo cleanup: forgot ${deleted} memories past retention`);
    } catch (err) {
      console.error("demo cleanup failed:", err);
    }
    return { statusCode: 200, headers: {}, body: "cleanup complete" };
  }

  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path;
  const origin = event.headers?.["origin"] ?? event.headers?.["Origin"];

  // Handle CORS preflight
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(origin), body: "" };
  }

  // Validate origin
  if (ALLOWED_ORIGIN !== "*" && origin) {
    const allowed = ALLOWED_ORIGIN.split(",");
    if (!allowed.includes(origin)) {
      return respond(403, { error: "Origin not allowed" }, origin);
    }
  }

  // Rate limiting
  const clientIp =
    event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ??
    event.requestContext.http.sourceIp;

  const withinLimit = await checkRateLimit(clientIp);
  if (!withinLimit) {
    return respond(
      429,
      { error: "Rate limit exceeded. Max 500 requests per hour." },
      origin
    );
  }

  // Load secrets
  let secrets: Secrets;
  try {
    secrets = await getSecrets();
  } catch (err) {
    console.error("Failed to load secrets:", err);
    return respond(500, { error: "Internal configuration error" }, origin);
  }

  // Parse body for POST requests
  let body: Record<string, unknown> = {};
  if (method === "POST" && event.body) {
    try {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf-8")
        : event.body;
      body = JSON.parse(raw);
    } catch {
      return respond(400, { error: "Invalid JSON body" }, origin);
    }
  }

  // Router
  try {
    if (method === "POST" && path === "/api/chat") {
      const result = await handleChat(body as unknown as ChatRequest, secrets);
      return { ...result, headers: { ...result.headers, ...corsHeaders(origin) } };
    }

    if (method === "POST" && path === "/api/reset") {
      const result = await handleReset(body as unknown as ResetRequest, secrets);
      return { ...result, headers: { ...result.headers, ...corsHeaders(origin) } };
    }

    if (method === "GET" && path === "/api/memories") {
      const result = await handleMemories(event.queryStringParameters ?? {}, secrets);
      return { ...result, headers: { ...result.headers, ...corsHeaders(origin) } };
    }

    if (method === "POST" && path === "/api/seed") {
      const result = await handleSeed(body as unknown as SeedRequest, secrets);
      return { ...result, headers: { ...result.headers, ...corsHeaders(origin) } };
    }

    if (method === "POST" && path === "/api/explore") {
      const result = await handleExplore(
        body as { session_id?: string; text?: string; turn_id?: number },
        secrets
      );
      return { ...result, headers: { ...result.headers, ...corsHeaders(origin) } };
    }

    // Health check
    if (method === "GET" && (path === "/" || path === "/api/health")) {
      return respond(200, { status: "ok", version: "1.0.0" }, origin);
    }

    return respond(404, { error: `Not found: ${method} ${path}` }, origin);
  } catch (err) {
    console.error("Unhandled error:", err);
    return respond(500, { error: "Something went wrong. Please try again." }, origin);
  }
};
