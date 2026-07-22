import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ForceGraph2D from 'react-force-graph-2d'
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ArrowLeft, CornerDownLeft, AlertTriangle, Users } from 'lucide-react'
import { explore, type ExploreResponse } from '../lib/api'

// ---------------------------------------------------------------------------
// Graph Explorer: one SHARED living knowledge graph. Anyone's text flows
// through the real engine; extraction is asynchronous, so the choreography is
// recall first (camera dives into what the graph already knows), then a
// consolidation watch that births the new facts as the engine weaves them in.
// Other visitors' memories arrive live through the same ambient poll.
// ---------------------------------------------------------------------------

// Everyone explores the same space; the platform's nightly cleanup resets it.
const SHARED_SESSION = 'graph-shared-v1'

type Stage = 'boot' | 'idle' | 'tokenize' | 'extract' | 'recall' | 'consolidate'

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
  boot: 'Waking the shared graph',
  idle: '',
  tokenize: 'Parsing your words',
  extract: 'Reading it, recalling what connects',
  recall: 'This is what it remembers',
  consolidate: 'Weaving your words into the graph',
}

const EDGE_COLORS: Record<string, string> = {
  contradicts: 'rgba(248,113,113,0.55)',
  supersedes: 'rgba(251,191,36,0.5)',
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
const linkKey = (s: string, t: string, type: string) => `${s}|${t}|${type}`
const endpointId = (e: string | GNode) => (typeof e === 'string' ? e : e.id)
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <line x1="16" y1="6" x2="8" y2="22" stroke="#34d399" strokeWidth="2" strokeLinecap="round" />
      <line x1="16" y1="6" x2="24" y2="22" stroke="#34d399" strokeWidth="2" strokeLinecap="round" />
      <line x1="8" y1="22" x2="24" y2="22" stroke="#34d399" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="6" r="3.5" fill="#34d399" />
      <circle cx="8" cy="22" r="3.5" fill="#34d399" />
      <circle cx="24" cy="22" r="3.5" fill="#34d399" />
      <circle cx="16" cy="6" r="1.5" fill="#0a0a0a" />
      <circle cx="8" cy="22" r="1.5" fill="#0a0a0a" />
      <circle cx="24" cy="22" r="1.5" fill="#0a0a0a" />
    </svg>
  )
}

export default function GraphExplorer() {
  const reduced = useReducedMotion()
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined)
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })

  const [stage, setStage] = useState<Stage>('boot')
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const [tokens, setTokens] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [contradiction, setContradiction] = useState<{ old: string; new: string } | null>(null)
  const [arrivals, setArrivals] = useState(0)
  const busyRef = useRef(false)
  const turnRef = useRef(1)
  const submitTokenRef = useRef(0)
  const fontReadyRef = useRef(false)

  const dataRef = useRef<{ nodes: GNode[]; links: GLink[] }>({ nodes: [], links: [] })
  const [graphData, setGraphData] = useState(dataRef.current)

  // Per-frame paint state in refs: the canvas loop never triggers re-renders.
  const paintRef = useRef({
    fresh: new Map<string, number>(),
    recalled: new Set<string>(),
    pulses: new Map<string, number>(),
    activeEdges: new Set<string>(),
    spotlight: false,
    degree: new Map<string, number>(),
  })
  const hoverRef = useRef<GNode | null>(null)

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    document.fonts?.ready.then(() => {
      fontReadyRef.current = true
    })
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

  /** Merge a response into the live graph without ever wiping it: existing
   *  node objects (and their positions) are preserved; an empty or failed
   *  listing never clears what is already on screen. */
  const mergeGraph = useCallback(
    (res: Pick<ExploreResponse, 'nodes' | 'edges'>, placeAt?: { x: number; y: number }) => {
      const existing = new Map(dataRef.current.nodes.map((n) => [n.id, n]))
      if (res.nodes.length === 0 && existing.size > 0) {
        return { added: [] as string[], addedLinks: [] as GLink[] }
      }
      const nodes: GNode[] = []
      const seen = new Set<string>()
      const added: string[] = []
      for (const n of res.nodes) {
        seen.add(n.id)
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
      // Keep nodes the listing may have paged out rather than dropping them.
      for (const [id, n] of existing) if (!seen.has(id)) nodes.push(n)

      const prevLinks = new Map(dataRef.current.links.map((l) => [l.key, l]))
      const links: GLink[] = [...prevLinks.values()]
      const addedLinks: GLink[] = []
      for (const e of res.edges) {
        const key = linkKey(e.source, e.target, e.type)
        if (!prevLinks.has(key)) {
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

  const safeZoomToFit = useCallback((ms: number, pad: number, filter?: (n: GNode) => boolean) => {
    try {
      const nodes = dataRef.current.nodes.filter((n) => n.x !== undefined)
      if (nodes.length === 0) return
      if (filter && !nodes.some(filter)) return
      fgRef.current?.zoomToFit(ms, pad, filter as ((n: NodeObject) => boolean) | undefined)
    } catch {
      /* camera moves must never take the page down */
    }
  }, [])

  // Boot: load the shared graph (the lambda self-seeds it when empty).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await explore(SHARED_SESSION, '', 0)
        if (cancelled) return
        mergeGraph(res)
        setStage('idle')
        setTimeout(() => safeZoomToFit(900, 90), 700)
      } catch {
        if (!cancelled) {
          setError('The engine is waking up. Type something to retry.')
          setStage('idle')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mergeGraph, safeZoomToFit])

  // Ambient live poll: other explorers' memories drift in while you watch.
  useEffect(() => {
    const id = setInterval(async () => {
      if (busyRef.current || document.hidden || stage === 'boot') return
      try {
        const res = await explore(SHARED_SESSION, '', 0)
        const before = dataRef.current.nodes.length
        const { added } = mergeGraph(res)
        if (added.length > 0 && before > 0) {
          const now = performance.now()
          for (const id of added) {
            paintRef.current.fresh.set(id, now)
            paintRef.current.pulses.set(id, now)
          }
          fgRef.current?.d3ReheatSimulation()
          setArrivals((a) => a + added.length)
          setTimeout(() => setArrivals(0), 5000)
        }
      } catch {
        /* ambient polls fail silently */
      }
    }, 6000)
    return () => clearInterval(id)
  }, [mergeGraph, stage])

  /** Watch the engine consolidate: extraction is asynchronous, so poll until
   *  the new facts land as nodes, then birth them near the input. */
  const watchConsolidation = useCallback(
    async (token: number, drop: { x: number; y: number }) => {
      for (let i = 0; i < 7; i++) {
        await delay(1600)
        if (submitTokenRef.current !== token) return
        try {
          const res = await explore(SHARED_SESSION, '', 0)
          if (submitTokenRef.current !== token) return
          const { added, addedLinks } = mergeGraph(res, drop)
          if (added.length > 0) {
            const now = performance.now()
            for (const id of added) {
              paintRef.current.fresh.set(id, now)
              paintRef.current.pulses.set(id, now)
            }
            fgRef.current?.d3ReheatSimulation()
            addedLinks.forEach((l, j) => {
              paintRef.current.activeEdges.add(l.key)
              if (!reduced) setTimeout(() => fgRef.current?.emitParticle(l), j * 160)
            })
            await delay(1400)
            if (submitTokenRef.current !== token) return
            safeZoomToFit(800, 120, (n) => paintRef.current.fresh.has(n.id) || paintRef.current.recalled.has(n.id))
            break
          }
        } catch {
          /* keep watching */
        }
      }
      if (submitTokenRef.current === token) setStage('idle')
    },
    [mergeGraph, reduced, safeZoomToFit],
  )

  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || busyRef.current) return
      busyRef.current = true
      setBusy(true)
      setError(null)
      setContradiction(null)
      setInput('')
      const token = ++submitTokenRef.current

      const paint = paintRef.current
      paint.fresh.clear()
      paint.recalled.clear()
      paint.activeEdges.clear()
      paint.spotlight = false

      try {
        // Tokenize on screen while the engine call runs underneath.
        setTokens(text.split(/\s+/).slice(0, 24))
        setStage('tokenize')
        const pending = explore(SHARED_SESSION, text, ++turnRef.current)
        await delay(reduced ? 80 : 850)
        setStage('extract')

        let res: ExploreResponse
        try {
          res = await pending
        } catch (e) {
          setError(e instanceof Error ? e.message : 'The engine is unavailable right now.')
          setStage('idle')
          setTokens([])
          return
        }
        setTokens([])
        if (res.contradiction) {
          setContradiction(res.contradiction)
          setTimeout(() => setContradiction(null), 8000)
        }
        mergeGraph(res)

        // Recall: the graph itself tells the story. Recalled memories light
        // up with labels, their edges flow, and the camera dives in.
        setStage('recall')
        const now = performance.now()
        const recalledIds = res.recalled.map((r) => r.id).filter((id): id is string => !!id)
        for (const id of recalledIds) {
          paint.recalled.add(id)
          paint.pulses.set(id, now)
          for (const l of dataRef.current.links) {
            if (endpointId(l.source) === id || endpointId(l.target) === id) {
              paint.activeEdges.add(l.key)
              if (!reduced) fgRef.current?.emitParticle(l)
            }
          }
        }
        paint.spotlight = recalledIds.length > 0
        if (recalledIds.length > 0) {
          safeZoomToFit(800, 130, (n) => paint.recalled.has(n.id))
          // A brief camera dive into the strongest recalls, labels showing.
          if (!reduced) {
            await delay(950)
            const byId = new Map(dataRef.current.nodes.map((n) => [n.id, n]))
            for (const id of recalledIds.slice(0, 2)) {
              if (submitTokenRef.current !== token) return
              const n = byId.get(id)
              if (n?.x === undefined || n.y === undefined) continue
              try {
                fgRef.current?.centerAt(n.x, n.y, 650)
                fgRef.current?.zoom(2.6, 650)
              } catch {
                /* ignore camera failures */
              }
              await delay(1150)
            }
            safeZoomToFit(800, 130, (n) => paint.recalled.has(n.id))
          }
          await delay(reduced ? 200 : 900)
        } else {
          await delay(reduced ? 100 : 500)
        }
        paint.spotlight = false

        // Consolidation: watch the engine weave the new facts in (async
        // extraction), birthing nodes as they land. Input unlocks now; the
        // watcher keeps running in the background.
        setStage('consolidate')
        const drop = fgRef.current?.screen2GraphCoords(size.w / 2, size.h * 0.55) ?? { x: 0, y: 0 }
        void watchConsolidation(token, drop)
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [reduced, size, mergeGraph, safeZoomToFit, watchConsolidation],
  )

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

      let fill = '#8e8e96'
      if (isFresh) {
        const t = Math.min(1, (now - (born as number)) / 1800)
        const lerp = (a: number, b: number) => Math.round(a + (b - a) * t)
        fill = `rgb(${lerp(244, 52)},${lerp(244, 211)},${lerp(245, 153)})`
      } else if (isRecalled) {
        fill = '#6ee7b7'
      }
      if (dimmed) fill = 'rgba(82,82,91,0.30)'

      if ((isFresh || isRecalled || isHover) && !reduced) {
        ctx.shadowColor = isRecalled ? '#34d399' : '#a7f3d0'
        ctx.shadowBlur = 16
      }
      ctx.beginPath()
      ctx.arc(x, y, r, 0, 2 * Math.PI)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.shadowBlur = 0

      if (!dimmed) {
        ctx.beginPath()
        ctx.arc(x, y, Math.max(0.8, r * 0.33), 0, 2 * Math.PI)
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        ctx.fill()
      }

      // Labels: recalled and fresh memories tell the story on-canvas; hover
      // reveals the rest. Crisp only once the webfont is actually loaded.
      const showLabel = (isHover || isRecalled || isFresh) && scale > 0.5 && fontReadyRef.current
      if (showLabel) {
        const label = truncate(node.content, 52)
        const fontSize = Math.max(11, 12) / scale
        ctx.font = `500 ${fontSize}px Inter, system-ui, -apple-system, "Segoe UI", sans-serif`
        const w = ctx.measureText(label).width
        const padX = 6 / scale
        const padY = 3.5 / scale
        const bx = x - w / 2 - padX
        const by = y + r + 5 / scale
        const bh = fontSize + padY * 2
        ctx.fillStyle = 'rgba(9,9,11,0.92)'
        ctx.strokeStyle = isRecalled ? 'rgba(52,211,153,0.35)' : 'rgba(63,63,70,0.8)'
        ctx.lineWidth = 1 / scale
        ctx.beginPath()
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(bx, by, w + padX * 2, bh, 4 / scale)
        } else {
          ctx.rect(bx, by, w + padX * 2, bh)
        }
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = isRecalled ? '#a7f3d0' : '#f4f4f5'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(label, x, by + padY)
      }
    },
    [reduced],
  )

  const linkColor = useCallback((l: GLink) => {
    if (paintRef.current.activeEdges.has(l.key)) return 'rgba(52,211,153,0.55)'
    return EDGE_COLORS[l.type] ?? 'rgba(113,113,122,0.16)'
  }, [])

  const stageLabel = STAGE_LABEL[stage]

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100">
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
          <span className="hidden items-center gap-2 text-sm font-semibold sm:flex">
            <Logo size={18} /> Graph Explorer
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span className="hidden items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 backdrop-blur sm:flex">
            <Users size={12} className="text-emerald-400" />
            One shared graph, resets nightly
          </span>
          <a
            href="https://github.com/nambok/mentedb"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-emerald-400"
          >
            Engine ↗
          </a>
        </div>
      </header>

      {/* contradiction alert */}
      <AnimatePresence>
        {contradiction && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="absolute left-1/2 top-16 w-full max-w-md -translate-x-1/2 rounded-xl border border-red-500/25 bg-zinc-950/90 p-3 backdrop-blur"
          >
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-red-400">
              <AlertTriangle size={13} /> Contradiction detected and resolved
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              <span className="line-through opacity-60">{truncate(contradiction.old, 90)}</span>
              <br />
              <span className="text-zinc-200">{truncate(contradiction.new, 90)}</span>
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* live arrivals from other explorers */}
      <AnimatePresence>
        {arrivals > 0 && (
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-40 left-5 flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-zinc-950/85 px-3 py-1.5 text-xs text-emerald-300 backdrop-blur"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            {arrivals === 1 ? 'A new memory just arrived' : `${arrivals} new memories just arrived`}
          </motion.div>
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
              placeholder="Tell the graph something. Watch it remember."
              className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none"
            />
            <button
              type="submit"
              disabled={!input.trim() || busy}
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
              disabled={busy}
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
