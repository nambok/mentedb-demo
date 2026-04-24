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
// Bedrock (Claude) helper
// ---------------------------------------------------------------------------

const BEDROCK_MODEL_ID = "us.anthropic.claude-sonnet-4-20250514-v1:0";

async function callBedrock(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const payload = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };

  const command = new InvokeModelCommand({
    modelId: BEDROCK_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: new TextEncoder().encode(JSON.stringify(payload)),
  });

  const response = await bedrockClient.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.body)) as {
    content: Array<{ type: string; text?: string }>;
  };

  return (
    result.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("") || ""
  );
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

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
  let systemPrompt: string;

  if (mode === "with_memory") {
    // 1. Call process_turn to recall + store
    const turnResult = (await mentedbToolCall(secrets, "process_turn", {
      user_message: lastUserMsg,
      assistant_response: "",
      turn_id: turnId,
      project_context: `demo-${session_id}`,
    })) as {
      context?: MemoryContext[];
      contradictions?: number;
      contradiction_details?: Array<{ old_content: string; new_content: string }>;
      pain_warnings?: string[];
      memories_stored?: Array<{ content: string; memory_type: string }>;
    };

    memoriesUsed = turnResult?.context ?? [];
    const contradictions = turnResult?.contradiction_details ?? [];
    const painWarnings = turnResult?.pain_warnings ?? [];
    memoriesStored = turnResult?.memories_stored ?? [];
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
      ? `\n\n⚠️ Pain signals:\n${painWarnings.join("\n")}`
      : "";

    const contradictionContext = contradictionDetected
      ? `\n\n⚡ Contradiction detected: "${contradictionDetected.old}" → "${contradictionDetected.new}". Acknowledge this change.`
      : "";

    systemPrompt = [
      "You are a helpful AI assistant with persistent memory powered by MenteDB.",
      "You remember previous conversations and preferences.",
      "",
      "Recalled memories:",
      memoriesFormatted,
      painContext,
      contradictionContext,
      "",
      "Use these memories naturally in your responses.",
      "Reference relevant context without being awkward about it.",
      "If a contradiction was detected, acknowledge the change naturally.",
    ].join("\n");
  } else {
    systemPrompt =
      "You are a helpful AI assistant. Answer questions concisely and helpfully.";
  }

  // 3. Call Bedrock
  const responseText = await callBedrock(
    systemPrompt,
    messages
  );

  // 4. For with_memory mode, store assistant response context
  if (mode === "with_memory") {
    // Fire-and-forget: store the assistant response for the turn
    mentedbToolCall(secrets, "process_turn", {
      user_message: lastUserMsg,
      assistant_response: responseText.slice(0, 500),
      turn_id: turnId,
      project_context: `demo-${session_id}`,
    }).catch(() => {});
  }

  return respond(200, {
    response: responseText,
    model: BEDROCK_MODEL_ID,
    memories_used: memoriesUsed.map((m) => ({
      content: m.content,
      relevance: m.relevance_score ?? null,
      type: m.memory_type ?? "unknown",
    })),
    memories_stored: memoriesStored.map((m) => ({
      content: m.content,
      type: m.memory_type ?? m.type ?? "unknown",
    })),
    contradiction_detected: contradictionDetected,
    turn_id: turnId,
    mode,
  });
}

async function handleReset(
  body: ResetRequest,
  secrets: Secrets
): Promise<LambdaResponse> {
  const { session_id } = body;
  if (!session_id) {
    return respond(400, { error: "Missing session_id" });
  }

  try {
    await mentedbToolCall(secrets, "forget_all", {
      confirm: "CONFIRM",
    });
  } catch (err) {
    console.error("Reset error:", err);
    return respond(500, { error: "Failed to reset session" });
  }

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

    const result = await mentedbRestGet(secrets, `/api/memories?${params.toString()}`);
    return respond(200, result as Record<string, unknown>);
  } catch (err) {
    console.error("Memories fetch error:", err);
    return respond(500, { error: "Failed to fetch memories" });
  }
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

  let seeded = 0;
  for (const mem of memories) {
    try {
      await mentedbToolCall(secrets, "store_memory", {
        content: mem.content,
        memory_type: mem.memory_type,
        tags: mem.tags,
      });
      seeded++;
    } catch (err) {
      console.error(`Failed to seed memory: ${mem.content}`, err);
    }
  }

  return respond(200, { ok: true, seeded });
}

// ---------------------------------------------------------------------------
// Main Lambda handler
// ---------------------------------------------------------------------------

export const handler = async (
  event: LambdaFunctionUrlEvent
): Promise<LambdaResponse> => {
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

    // Health check
    if (method === "GET" && (path === "/" || path === "/api/health")) {
      return respond(200, { status: "ok", version: "1.0.0" }, origin);
    }

    return respond(404, { error: `Not found: ${method} ${path}` }, origin);
  } catch (err) {
    console.error("Unhandled error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return respond(500, { error: message }, origin);
  }
};
