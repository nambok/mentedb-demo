import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import {
  agentFileStatus,
  askAgentFile,
  ingestAgentFile,
  type AgentFileAskResponse,
  type IngestStatus,
} from '../lib/api'

interface Preset {
  key: string
  name: string
  size: string
  fileTokens: number
  tasks: string[]
}

const PRESETS: Preset[] = [
  {
    key: 'codex',
    name: 'OpenAI codex',
    size: '22 KB AGENTS.md',
    fileTokens: 5600,
    tasks: [
      'Write a commit message for a fix that stops a crash when the TUI resizes',
      'How do I run the tests for a change inside codex-rs?',
      'Add a new subcommand flag and tell me what to update',
    ],
  },
  {
    key: 'kiali',
    name: 'Kiali',
    size: '70 KB AGENTS.md, the biggest',
    fileTokens: 17500,
    tasks: [
      'Add a Refresh button to the toolbar component',
      'What should I run before finishing a Go change?',
      'Write a table cell that shows the workload health label',
    ],
  },
  {
    key: 'temporal',
    name: 'Temporal',
    size: '8 KB AGENTS.md',
    fileTokens: 2100,
    tasks: [
      'Write a unit test for a new history service helper',
      'What is the process for adding a new proto field?',
      'Draft a PR description for a matching engine fix',
    ],
  },
]

const NUM = new Intl.NumberFormat('en-US')

function Meter({
  label,
  tokens,
  max,
  tone,
}: {
  label: string
  tokens: number
  max: number
  tone: 'file' | 'memory'
}) {
  const width = Math.max(2, Math.round((tokens / Math.max(max, 1)) * 100))
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-sm text-zinc-400">{label}</span>
        <span
          className={`text-sm font-semibold ${tone === 'memory' ? 'text-emerald-400' : 'text-zinc-300'}`}
        >
          {NUM.format(tokens)} tokens
        </span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-800/80">
        <div
          className={`h-full rounded-full ${tone === 'memory' ? 'bg-emerald-500' : 'bg-zinc-500'}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

export default function AgentFiles() {
  const [sessionId] = useState(() => crypto.randomUUID())
  const [preset, setPreset] = useState<Preset | null>(PRESETS[0])
  const [pasted, setPasted] = useState('')
  const [pastedTokens, setPastedTokens] = useState(0)
  const [pastedReady, setPastedReady] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [ingestReport, setIngestReport] = useState<IngestStatus['report']>(null)
  const [ingestError, setIngestError] = useState('')
  const [prompt, setPrompt] = useState(PRESETS[0].tasks[0])
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState('')
  const [result, setResult] = useState<AgentFileAskResponse | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const sourceReady = preset !== null || pastedReady

  function choosePreset(p: Preset) {
    setPreset(p)
    setPrompt(p.tasks[0])
    setResult(null)
    setAskError('')
  }

  async function startIngest() {
    if (ingesting || pasted.trim().length < 200) return
    setPreset(null)
    setResult(null)
    setIngestError('')
    setIngestReport(null)
    setPastedReady(false)
    setIngesting(true)
    try {
      const { job_id, file_tokens } = await ingestAgentFile(sessionId, pasted)
      setPastedTokens(file_tokens)
      pollRef.current = setInterval(async () => {
        const st = await agentFileStatus(job_id)
        if (st.status === 'done') {
          if (pollRef.current) clearInterval(pollRef.current)
          setIngestReport(st.report ?? null)
          setPastedReady(true)
          setIngesting(false)
        } else if (st.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current)
          setIngestError(st.report?.error || 'Parsing failed, try another file.')
          setIngesting(false)
        }
      }, 2500)
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : 'Ingest failed')
      setIngesting(false)
    }
  }

  async function ask() {
    if (asking || !sourceReady || prompt.trim().length < 4) return
    setAsking(true)
    setAskError('')
    setResult(null)
    try {
      const res = await askAgentFile({
        session_id: sessionId,
        prompt,
        preset: preset?.key,
        file_tokens: preset ? undefined : pastedTokens,
      })
      setResult(res)
    } catch (err) {
      setAskError(err instanceof Error ? err.message : 'Ask failed')
    } finally {
      setAsking(false)
    }
  }

  const savings =
    result && result.mem_tokens > 0 && result.file_tokens > 0
      ? (result.file_tokens / result.mem_tokens).toFixed(1)
      : null

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <ArrowLeft size={15} /> All demos
        </Link>
        <a
          href="https://mentedb.com"
          className="text-sm font-semibold text-zinc-300 hover:text-emerald-400"
        >
          MenteDB
        </a>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Agent files as memory
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Stop carrying your AGENTS.md on every turn
        </h1>
        <p className="mt-3 text-zinc-400">
          Pick a real public agent file, or paste your own. It is ingested into
          MenteDB once. Then give the agent a task and watch the handful of rules
          that govern it arrive, instead of the whole file.{' '}
          <a
            href="https://mentedb.com/blog/infinite-context-window-for-ai-with-memory"
            className="text-emerald-400 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Read the measurements
          </a>
          .
        </p>

        {/* Step 1: source */}
        <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            1 · Choose the instruction file
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => choosePreset(p)}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  preset?.key === p.key
                    ? 'border-emerald-500/60 bg-emerald-500/10'
                    : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-600'
                }`}
              >
                <div className="font-semibold">{p.name}</div>
                <div className="mt-1 text-xs text-zinc-400">{p.size}</div>
                <div className="mt-2 text-xs text-zinc-500">
                  ~{NUM.format(p.fileTokens)} tokens per turn if carried
                </div>
              </button>
            ))}
          </div>

          <div className="mt-4">
            <textarea
              value={pasted}
              onChange={(e) => {
                setPasted(e.target.value)
                setPastedReady(false)
              }}
              placeholder="…or paste your own CLAUDE.md / AGENTS.md / .cursorrules here (up to 200 KB)"
              rows={4}
              className="w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 text-sm text-zinc-200 placeholder-zinc-600 focus:border-emerald-500/50 focus:outline-none"
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={startIngest}
                disabled={ingesting || pasted.trim().length < 200}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {ingesting ? 'Parsing in the background…' : 'Ingest my file'}
              </button>
              {ingesting && (
                <span className="text-xs text-zinc-500">
                  Large files take a minute or two; rules become memories as it parses.
                </span>
              )}
              {pastedReady && ingestReport && (
                <span className="text-xs text-emerald-400">
                  {NUM.format(ingestReport.stored ?? 0)} memories stored,{' '}
                  {NUM.format(ingestReport.trigger_tagged ?? 0)} action triggers, 0 pinned to
                  every prompt
                </span>
              )}
              {ingestError && <span className="text-xs text-red-400">{ingestError}</span>}
            </div>
          </div>
        </section>

        {/* Step 2: ask */}
        <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            2 · Give the agent a task
          </h2>
          {preset && (
            <div className="mt-3 flex flex-wrap gap-2">
              {preset.tasks.map((t) => (
                <button
                  key={t}
                  onClick={() => setPrompt(t)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    prompt === t
                      ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                      : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ask()}
              placeholder="Describe a task in this repository's world"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-emerald-500/50 focus:outline-none"
            />
            <button
              onClick={ask}
              disabled={asking || !sourceReady || prompt.trim().length < 4}
              className="shrink-0 rounded-xl bg-emerald-500 px-5 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {asking ? 'Working…' : 'Ask'}
            </button>
          </div>
          {!sourceReady && (
            <p className="mt-2 text-xs text-zinc-500">
              Pick a preset above or ingest your own file first.
            </p>
          )}
          {askError && <p className="mt-2 text-xs text-red-400">{askError}</p>}
        </section>

        {/* Results */}
        {result && (
          <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              What this turn cost
            </h2>
            <div className="mt-4 space-y-4">
              <Meter
                label="Carrying the whole file in context"
                tokens={result.file_tokens}
                max={result.file_tokens}
                tone="file"
              />
              <Meter
                label="Rules delivered from memory"
                tokens={result.mem_tokens}
                max={result.file_tokens}
                tone="memory"
              />
            </div>
            {savings && (
              <p className="mt-3 text-sm text-emerald-400">
                {savings}x fewer instruction tokens on this turn, and the cost stays flat no
                matter how big the file grows.
              </p>
            )}

            <h3 className="mt-6 text-sm font-semibold uppercase tracking-wider text-zinc-500">
              The rules that arrived (receipts)
            </h3>
            {result.rules.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">
                No file rules were relevant to this task, so none were injected. That is the
                point: irrelevant rules cost nothing.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {result.rules.map((r, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-300"
                  >
                    <span className="mr-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-400">
                      {r.reason}
                    </span>
                    {r.content}
                  </li>
                ))}
              </ul>
            )}

            <h3 className="mt-6 text-sm font-semibold uppercase tracking-wider text-zinc-500">
              The agent&apos;s answer ({result.model})
            </h3>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-300">
              {result.answer}
            </pre>
          </section>
        )}

        <p className="mt-8 text-xs text-zinc-600">
          Measured on the full benchmark: 100 percent of tested rules followed at 2 to 8 times
          fewer tokens than carrying the file.{' '}
          <a
            href="https://github.com/nambok/mentedb/tree/main/benchmarks/agent_file"
            className="text-zinc-400 hover:text-emerald-400"
            target="_blank"
            rel="noopener noreferrer"
          >
            Rerun it yourself
          </a>
          .
        </p>
      </main>
    </div>
  )
}
