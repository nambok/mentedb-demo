import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ForceGraph2D from 'react-force-graph-2d'
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ArrowLeft, CornerDownLeft, RotateCcw, Sparkles, AlertTriangle, Zap } from 'lucide-react'
import { explore, seedPersona, type ExploreResponse } from '../lib/api'

// ---------------------------------------------------------------------------
// Graph Explorer: type anything, watch the engine break it into facts, weave
// them into a living knowledge graph, and pull related memories back out.
// The choreography runs while the real engine call is in flight, so the
// pipeline animation doubles as the loading state.
// ---------------------------------------------------------------------------

type Stage = 'boot' | 'idle' | 'tokenize' | 'extract' | 'inject' | 'relate' | 'recall'

interface GNode extends NodeObject {
  id: string
  content: string
  memory_type: string
}

interface GLink extends LinkObject {
  source: string | GNode
  target: string | GNode
  type: string
  key: string
}

const STOPWORDS = new Set(
  'a an and are as at be but by for from has have i in is it my of on or our so that the their they this to was we with you your'.split(' '),
)

const SUGGESTIONS = [
  'I switched from MongoDB to Postgres last month',
  'My dog Max is allergic to chicken',
  'We deploy every Friday and Sarah reviews the release',
  'Actually I moved from Austin to Denver in March',
]

const STAGE_LABEL: Record<Stage, string> = {
  boot: 'Waking the engine',
  idle: '',
  tokenize: 'Parsing your words',
  extract: 'Extracting atomic facts',
  inject: 'Writing to memory',
  relate: 'Linking related memories',
  recall: 'Recalling what connects',
}

const EDGE_COLORS: Record<string, string> = {
  contradicts: 'rgba(248,113,113,0.55)',
  supersedes: 'rgba(251,191,36,0.5)',
}

function sessionIdInit(): string {
  const saved = localStorage.getItem('mentedb-graph-session')
  if (saved) return saved
  const id = `graph-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
  localStorage.setItem('mentedb-graph-session', id)
  return id
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
const linkKey = (s: string, t: string, type: string) => `${s}|${t}|${type}`
const endpointId = (e: string | GNode) => (typeof e === 'string' ? e : e.id)
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export default function GraphExplorer() {
  const reduced = useReducedMotion()
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined)
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })

  const [session, setSession] = useState(sessionIdInit)
  const [stage, setStage] = useState<Stage>('boot')
  const [input, setInput] = useState('')
  const [tokens, setTokens] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ExploreResponse | null>(null)
  const busyRef = useRef(false)
  const turnRef = useRef(1)

  // The live graph object: node/link object identity is preserved across
  // updates so the simulation keeps positions; arrays are re-created to
  // trigger the diff.
  const dataRef = useRef<{ nodes: GNode[]; links: GLink[] }>({ nodes: [], links: [] })
  const [graphData, setGraphData] = useState(dataRef.current)

  // Per-frame paint state lives in refs so the canvas never forces a re-render.
  const paintRef = useRef({
    fresh: new Map<string, number>(), // id -> bornAt ms
    recalled: new Set<string>(),
    pulses: new Map<string, number>(), // id -> pulse start ms
    activeEdges: new Set<string>(),
    spotlight: false,
    degree: new Map<string, number>(),
  })
  const hoverRef = useRef<GNode | null>(null)

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const recomputeDegrees = useCallback(() => {
    const deg = new Map<string, number>()
    for (const l of dataRef.current.links) {
      deg.set(endpointId(l.source), (deg.get(endpointId(l.source)) ?? 0) + 1)
      deg.set(endpointId(l.target), (deg.get(endpointId(l.target)) ?? 0) + 1)
    }
    paintRef.current.degree = deg
  }, [])

  /** Merge an explore response into the live graph, preserving existing node
   *  objects (and so their positions). Returns the ids of newly added nodes
   *  and the newly added link objects. */
  const mergeGraph = useCallback(
    (res: ExploreResponse, placeAt?: { x: number; y: number }) => {
      const existing = new Map(dataRef.current.nodes.map((n) => [n.id, n]))
      const nodes: GNode[] = []
      const added: string[] = []
      for (const n of res.nodes) {
        const prev = existing.get(n.id)
        if (prev) {
          nodes.push(prev)
        } else {
          const node: GNode = { id: n.id, content: n.content, memory_type: n.memory_type }
          if (placeAt) {
            node.x = placeAt.x + (Math.random() - 0.5) * 30
            node.y = placeAt.y + (Math.random() - 0.5) * 20
          }
          nodes.push(node)
          added.push(n.id)
        }
      }
      const prevLinks = new Map(dataRef.current.links.map((l) => [l.key, l]))
      const links: GLink[] = []
      const addedLinks: GLink[] = []
      for (const e of res.edges) {
        const key = linkKey(e.source, e.target, e.type)
        const prev = prevLinks.get(key)
        if (prev) {
          links.push(prev)
        } else {
          const l: GLink = { source: e.source, target: e.target, type: e.type, key }
          links.push(l)
          addedLinks.push(l)
        }
      }
      dataRef.current = { nodes, links }
      setGraphData({ nodes, links })
      recomputeDegrees()
      return { added, addedLinks }
    },
    [recomputeDegrees],
  )

  // Boot: seed the session once so arbitrary text has something to relate to,
  // then load the ambient graph.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const seededKey = `mentedb-graph-seeded-${session}`
        if (!localStorage.getItem(seededKey)) {
          await seedPersona(session, 'developer')
          localStorage.setItem(seededKey, '1')
        }
        const res = await explore(session, '', 0)
        if (cancelled) return
        mergeGraph(res)
        setStage('idle')
        setTimeout(() => fgRef.current?.zoomToFit(800, 90), 600)
      } catch {
        if (!cancelled) {
          setError('The demo engine is waking up. Try again in a moment.')
          setStage('idle')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [session, mergeGraph])

  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || busyRef.current) return
      busyRef.current = true
      setError(null)
      setResult(null)
      setInput('')

      const paint = paintRef.current
      paint.fresh.clear()
      paint.recalled.clear()
      paint.activeEdges.clear()
      paint.spotlight = false

      // Stage: tokenize, while the real engine call runs underneath.
      setTokens(text.split(/\s+/).slice(0, 24))
      setStage('tokenize')
      const pending = explore(session, text, ++turnRef.current)
      await delay(reduced ? 80 : 900)

      setStage('extract')
      let res: ExploreResponse
      try {
        res = await pending
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The engine is unavailable right now.')
        setStage('idle')
        setTokens([])
        busyRef.current = false
        return
      }
      setResult(res)
      await delay(reduced ? 80 : 1100)

      // Stage: inject, new facts fly into the graph near the input bar.
      setStage('inject')
      setTokens([])
      const drop = fgRef.current?.screen2GraphCoords(size.w / 2, size.h * 0.55) ?? { x: 0, y: 0 }
      const { added, addedLinks } = mergeGraph(res, drop)
      const now = performance.now()
      for (const s of res.stored) {
        if (s.id) {
          paint.fresh.set(s.id, now)
          paint.pulses.set(s.id, now)
        }
      }
      for (const id of added) {
        if (!paint.fresh.has(id)) paint.fresh.set(id, now)
      }
      fgRef.current?.d3ReheatSimulation()
      await delay(reduced ? 120 : 1000)

      // Stage: relate, this turn's edges light up with particle bursts.
      setStage('relate')
      const turnEdges =
        addedLinks.length > 0
          ? addedLinks
          : dataRef.current.links.filter((l) => {
              const ids = [endpointId(l.source), endpointId(l.target)]
              return ids.some((id) => paint.fresh.has(id))
            })
      turnEdges.forEach((l, i) => {
        paint.activeEdges.add(l.key)
        if (!reduced) setTimeout(() => fgRef.current?.emitParticle(l), i * 150)
      })
      await delay(reduced ? 120 : Math.min(1600, turnEdges.length * 150 + 500))

      // Stage: recall, the retrieved subgraph gets the spotlight.
      setStage('recall')
      const t2 = performance.now()
      for (const r of res.recalled) {
        if (r.id) {
          paint.recalled.add(r.id)
          paint.pulses.set(r.id, t2)
          const l = dataRef.current.links.filter(
            (lk) => endpointId(lk.source) === r.id || endpointId(lk.target) === r.id,
          )
          l.forEach((lk) => paint.activeEdges.add(lk.key))
        }
      }
      paint.spotlight = paint.recalled.size > 0 || paint.fresh.size > 0
      if (paint.spotlight) {
        fgRef.current?.zoomToFit(700, 110, (n) => paint.fresh.has(n.id) || paint.recalled.has(n.id))
      }
      await delay(reduced ? 200 : 2600)
      paint.spotlight = false
      setStage('idle')
      busyRef.current = false
    },
    [session, size, reduced, mergeGraph],
  )

  const reset = useCallback(() => {
    localStorage.removeItem('mentedb-graph-session')
    const id = sessionIdInit()
    dataRef.current = { nodes: [], links: [] }
    setGraphData(dataRef.current)
    paintRef.current.fresh.clear()
    paintRef.current.recalled.clear()
    paintRef.current.activeEdges.clear()
    setResult(null)
    setStage('boot')
    setSession(id)
  }, [])

  // --- canvas painting ---

  const paintNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const paint = paintRef.current
      const now = performance.now()
      const born = paint.fresh.get(node.id)
      const isFresh = born !== undefined
      const isRecalled = paint.recalled.has(node.id)
      const isHover = hoverRef.current?.id === node.id
      const dimmed = paint.spotlight && !isFresh && !isRecalled && !isHover
      const degree = paint.degree.get(node.id) ?? 0
      const r = 3 + Math.min(4.5, degree * 0.8) + (isFresh ? 1.4 : 0)
      const x = node.x ?? 0
      const y = node.y ?? 0

      // Expanding pulse ring for just-stored and just-recalled memories.
      const pulse = paint.pulses.get(node.id)
      if (pulse !== undefined) {
        const age = (now - pulse) / 1000
        if (age < 1.6) {
          ctx.beginPath()
          ctx.arc(x, y, r + age * 16, 0, 2 * Math.PI)
          ctx.strokeStyle = `rgba(110,231,183,${(0.5 * (1.6 - age)) / 1.6})`
          ctx.lineWidth = 1.4 / scale
          ctx.stroke()
        } else {
          paint.pulses.delete(node.id)
        }
      }

      // Fresh nodes are born white-hot and settle to emerald over ~1.8s.
      let fill = '#8e8e96'
      if (isFresh) {
        const t = Math.min(1, (now - (born as number)) / 1800)
        const lerp = (a: number, b: number) => Math.round(a + (b - a) * t)
        fill = `rgb(${lerp(244, 52)},${lerp(244, 211)},${lerp(245, 153)})`
      } else if (isRecalled) {
        fill = '#6ee7b7'
      }
      if (dimmed) fill = 'rgba(82,82,91,0.30)'

      // Glow only where it carries meaning: active or hovered nodes.
      if ((isFresh || isRecalled || isHover) && !reduced) {
        ctx.shadowColor = isRecalled ? '#34d399' : '#a7f3d0'
        ctx.shadowBlur = 16
      }
      ctx.beginPath()
      ctx.arc(x, y, r, 0, 2 * Math.PI)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.shadowBlur = 0

      // Lit-from-within core.
      if (!dimmed) {
        ctx.beginPath()
        ctx.arc(x, y, Math.max(0.8, r * 0.33), 0, 2 * Math.PI)
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        ctx.fill()
      }

      // Labels: hover and active nodes only, with a soft pill halo.
      if ((isHover || isRecalled || (isFresh && stage !== 'idle')) && scale > 0.6) {
        const label = truncate(node.content, 46)
        const fontSize = 11 / scale
        ctx.font = `${fontSize}px Inter, ui-sans-serif`
        const w = ctx.measureText(label).width
        const pad = 4 / scale
        ctx.fillStyle = 'rgba(9,9,11,0.85)'
        const bx = x - w / 2 - pad
        const by = y + r + 4 / scale
        const bh = fontSize + pad * 2
        ctx.beginPath()
        ctx.roundRect(bx, by, w + pad * 2, bh, 3 / scale)
        ctx.fill()
        ctx.fillStyle = isRecalled ? '#a7f3d0' : '#e4e4e7'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(label, x, by + pad)
      }
    },
    [reduced, stage],
  )

  const linkColor = useCallback((l: GLink) => {
    if (paintRef.current.activeEdges.has(l.key)) return 'rgba(52,211,153,0.55)'
    return EDGE_COLORS[l.type] ?? 'rgba(113,113,122,0.16)'
  }, [])

  const stageLabel = STAGE_LABEL[stage]

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100">
      {/* backdrop layers */}
      <div className="pointer-events-none absolute inset-0 bg-dotgrid" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 55% 45% at 50% 45%, rgba(16,185,129,0.06), transparent 70%)',
        }}
        aria-hidden
      />

      <ForceGraph2D
        ref={fgRef}
        width={size.w}
        height={size.h}
        graphData={graphData}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={(node, color, ctx) => {
          ctx.beginPath()
          ctx.arc(node.x ?? 0, node.y ?? 0, 9, 0, 2 * Math.PI)
          ctx.fillStyle = color
          ctx.fill()
        }}
        onNodeHover={(n) => {
          hoverRef.current = (n as GNode) ?? null
        }}
        linkColor={linkColor}
        linkWidth={(l) => (paintRef.current.activeEdges.has((l as GLink).key) ? 1.4 : 0.5)}
        linkCurvature={0.18}
        linkDirectionalParticles={(l) =>
          !reduced && paintRef.current.activeEdges.has((l as GLink).key) ? 2 : 0
        }
        linkDirectionalParticleSpeed={0.006}
        linkDirectionalParticleWidth={2.4}
        linkDirectionalParticleColor={() => '#6ee7b7'}
        cooldownTicks={200}
        d3AlphaDecay={0.03}
        d3VelocityDecay={0.35}
      />

      {/* vignette above canvas, below UI */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.55))' }}
        aria-hidden
      />

      {/* header */}
      <header className="absolute left-0 right-0 top-0 flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-100"
          >
            <ArrowLeft size={15} /> Demos
          </Link>
          <span className="hidden text-sm font-semibold sm:block">Graph Explorer</span>
        </div>
        <button
          onClick={reset}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 text-xs text-zinc-400 backdrop-blur transition-colors hover:text-zinc-100"
        >
          <RotateCcw size={13} /> Fresh session
        </button>
      </header>

      {/* results panel */}
      <AnimatePresence>
        {result && (
          <motion.aside
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-4 top-16 hidden max-h-[70vh] w-80 overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 backdrop-blur md:block"
          >
            {result.contradiction && (
              <div className="mb-3 rounded-lg border border-red-500/25 bg-red-500/[0.07] p-3">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-red-400">
                  <AlertTriangle size={13} /> Contradiction resolved
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  <span className="line-through opacity-60">{truncate(result.contradiction.old, 80)}</span>
                  <br />
                  <span className="text-zinc-200">{truncate(result.contradiction.new, 80)}</span>
                </p>
              </div>
            )}
            {result.stored.length > 0 && (
              <div className="mb-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                  <Sparkles size={13} /> Stored as memory
                </div>
                <ul className="space-y-1.5">
                  {result.stored.map((s, i) => (
                    <li key={i} className="rounded-lg bg-zinc-900/80 px-2.5 py-1.5 text-[11px] leading-relaxed text-zinc-300">
                      {s.content}
                      <span className="ml-1.5 text-[9px] uppercase tracking-wide text-zinc-600">{s.memory_type}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.recalled.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                  <Zap size={13} /> Recalled
                </div>
                <ul className="space-y-1.5">
                  {result.recalled.map((r, i) => (
                    <li key={i} className="rounded-lg bg-zinc-900/80 px-2.5 py-1.5">
                      <p className="text-[11px] leading-relaxed text-zinc-300">{truncate(r.content, 110)}</p>
                      <div className="mt-1 h-0.5 overflow-hidden rounded bg-zinc-800">
                        <div
                          className="h-full bg-emerald-500/70"
                          style={{ width: `${Math.round(Math.min(1, Math.max(0.05, r.relevance)) * 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.stored.length === 0 && result.recalled.length === 0 && (
              <p className="text-xs text-zinc-500">
                Nothing new extracted from that one. Try something with a concrete fact in it.
              </p>
            )}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* bottom: stage indicator, tokens, input */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-4 pb-6">
        <AnimatePresence mode="wait">
          {stageLabel && (
            <motion.div
              key={stage}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className="flex items-center gap-2 text-xs font-medium text-emerald-300/90"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              {stageLabel}
            </motion.div>
          )}
        </AnimatePresence>

        {/* tokenized sentence during the pipeline */}
        <AnimatePresence>
          {tokens.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -18, transition: { duration: 0.4 } }}
              className="flex max-w-2xl flex-wrap justify-center gap-1.5"
            >
              {tokens.map((t, i) => {
                const stop = STOPWORDS.has(t.toLowerCase().replace(/[^a-z]/g, ''))
                return (
                  <motion.span
                    key={`${i}-${t}`}
                    initial={{ opacity: 0, y: 10, scale: 0.9 }}
                    animate={{ opacity: stop ? 0.35 : 1, y: 0, scale: 1 }}
                    transition={{ delay: reduced ? 0 : i * 0.035, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className={`rounded-md px-2 py-0.5 text-xs ${
                      stop
                        ? 'bg-zinc-900 text-zinc-500'
                        : 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
                    }`}
                  >
                    {t}
                  </motion.span>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit(input)
          }}
          className="w-full max-w-2xl"
        >
          <div className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/80 px-4 py-3 backdrop-blur transition-colors focus-within:border-emerald-500/40">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={600}
              placeholder="Tell it anything. Watch it remember."
              className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none"
              disabled={stage === 'boot'}
            />
            <button
              type="submit"
              disabled={!input.trim() || busyRef.current}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-30"
              aria-label="Send"
            >
              <CornerDownLeft size={15} />
            </button>
          </div>
        </form>

        <div className="flex max-w-2xl flex-wrap justify-center gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => submit(s)}
              disabled={busyRef.current || stage === 'boot'}
              className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-[11px] text-zinc-400 backdrop-blur transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
