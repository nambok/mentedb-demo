import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ForceGraph2D from 'react-force-graph-2d'
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ArrowLeft, CornerDownLeft, AlertTriangle, Users, Crosshair } from 'lucide-react'
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

const SUGGESTION_POOL = [
  'I switched from MongoDB to Postgres last month',
  'My dog Max is allergic to chicken',
  'We deploy every Friday and Sarah reviews the release',
  'Actually I moved from Austin to Denver in March',
  'What database do I use?',
  'My favorite editor is Neovim with a Catppuccin theme',
  'Our API rate limit is 1000 requests per minute',
  'I am training for a marathon in October',
  'Remind me what I said about deployments',
  'My sister Ana is visiting next weekend',
  'We migrated the frontend from Vue to React last quarter',
  'I only drink decaf after noon',
  'The staging environment lives in eu-west-1',
  'What do you know about my pets?',
  'Our design system uses an emerald accent on dark zinc',
  'I picked up climbing again after two years off',
  'The standup moved to 9:30 on Tuesdays',
  'What did people tell you about their stacks?',
  'My car is an old Land Cruiser I refuse to sell',
  'We cut a release candidate every other Thursday',
]

function pickSuggestions(n = 4): string[] {
  const pool = [...SUGGESTION_POOL]
  const out: string[] = []
  while (out.length < n && pool.length > 0) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
  }
  return out
}

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
  recall: 'rgba(52,211,153,0.35)',
  similar: 'rgba(134,146,144,0.22)',
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
  const [answer, setAnswer] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>(() => pickSuggestions())
  const [focus, setFocus] = useState<{
    content: string
    connections: Array<{ type: string; content: string }>
  } | null>(null)
  const busyRef = useRef(false)
  const turnRef = useRef(1)
  const submitTokenRef = useRef(0)
  const fontReadyRef = useRef(false)
  const didFitRef = useRef(false)

  const dataRef = useRef<{ nodes: GNode[]; links: GLink[] }>({ nodes: [], links: [] })
  const [graphData, setGraphData] = useState(dataRef.current)

  // Per-frame paint state in refs: the canvas loop never triggers re-renders.
  const paintRef = useRef({
    fresh: new Map<string, number>(),
    recalled: new Set<string>(),
    contradicted: new Set<string>(),
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
      // Anchor for newcomers: near a linked neighbor when one exists (so new
      // memories join locally), else the given drop point, else the centroid
      // of the settled graph. Never the origin, which reads as a fly-in from
      // nowhere.
      const settled = dataRef.current.nodes.filter((n) => n.x !== undefined)
      const centroid = settled.length
        ? {
            x: settled.reduce((s, n) => s + (n.x ?? 0), 0) / settled.length,
            y: settled.reduce((s, n) => s + (n.y ?? 0), 0) / settled.length,
          }
        : { x: 0, y: 0 }
      const anchorFor = (id: string): { x: number; y: number } => {
        for (const e of res.edges) {
          const other = e.source === id ? e.target : e.target === id ? e.source : null
          if (other) {
            const on = existing.get(other)
            if (on?.x !== undefined && on.y !== undefined) return { x: on.x, y: on.y }
          }
        }
        return placeAt ?? centroid
      }

      const nodes: GNode[] = []
      const seen = new Set<string>()
      const added: string[] = []
      for (const n of res.nodes) {
        // A node without a real id (or a duplicate) would corrupt the force
        // simulation; skip defensively.
        if (!n.id || seen.has(n.id)) continue
        seen.add(n.id)
        const prev = existing.get(n.id)
        if (prev) {
          nodes.push(prev)
        } else {
          const node: GNode = { id: n.id, content: n.content, memory_type: n.memory_type }
          const a = anchorFor(n.id)
          node.x = a.x + (Math.random() - 0.5) * 40
          node.y = a.y + (Math.random() - 0.5) * 30
          nodes.push(node)
          added.push(n.id)
        }
      }
      // Keep nodes the listing may have paged out rather than dropping them.
      for (const [id, n] of existing) {
        if (!seen.has(id)) {
          seen.add(id)
          nodes.push(n)
        }
      }

      const prevLinks = new Map(dataRef.current.links.map((l) => [l.key, l]))
      const links: GLink[] = [...prevLinks.values()]
      const addedLinks: GLink[] = []
      for (const e of res.edges) {
        // Never hand d3 an edge whose endpoint is not a known node.
        if (!seen.has(e.source) || !seen.has(e.target) || e.source === e.target) continue
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

  /** Remove the transient query node (and its retrieval edges) once the real
   *  fact nodes have taken over, keeping the shared graph clean. */
  const removeQueryNode = useCallback(() => {
    const { nodes, links } = dataRef.current
    const kept = nodes.filter((n) => !n.id.startsWith('query-'))
    if (kept.length === nodes.length) return
    const keptLinks = links.filter(
      (l) => !endpointId(l.source).startsWith('query-') && !endpointId(l.target).startsWith('query-'),
    )
    dataRef.current = { nodes: kept, links: keptLinks }
    setGraphData({ nodes: kept, links: keptLinks })
    recomputeDegrees()
  }, [recomputeDegrees])

  // --- Camera controller -----------------------------------------------
  // ONE owner for all camera motion (research: Google Maps discipline).
  // Auto-moves happen only on explicit user intent (boot, submit, click),
  // never from background polls; the user's own pan/zoom takes sovereignty
  // until the next explicit action or the re-center button.
  const isProgrammaticRef = useRef(false)
  const userOwnsCameraRef = useRef(false)
  const K_MIN = 0.4
  const K_MAX = 3.0

  const moveCamera = useCallback((x: number, y: number, k: number, ms = 600) => {
    try {
      isProgrammaticRef.current = true
      fgRef.current?.centerAt(x, y, ms)
      fgRef.current?.zoom(Math.max(K_MIN, Math.min(K_MAX, k)), ms)
    } catch {
      /* camera moves must never take the page down */
    }
  }, [])

  /** Frame a set of nodes in ONE eased move: bbox computed from current
   *  positions, zoom clamped BEFORE animating (never fit-then-correct). */
  const frame = useCallback(
    (filter?: (n: GNode) => boolean, ms = 600) => {
      try {
        if (userOwnsCameraRef.current) return
        const nodes = dataRef.current.nodes.filter((n) => n.x !== undefined)
        if (nodes.length === 0) return
        if (filter && !nodes.some(filter)) return
        const bb = fgRef.current?.getGraphBbox(
          filter as ((n: NodeObject) => boolean) | undefined,
        )
        if (!bb) return
        const w = Math.max(1, bb.x[1] - bb.x[0])
        const h = Math.max(1, bb.y[1] - bb.y[0])
        const cx = (bb.x[0] + bb.x[1]) / 2
        const cy = (bb.y[0] + bb.y[1]) / 2
        // Fill ~75% of the viewport, clamped to the readable band.
        const k = Math.max(
          K_MIN,
          Math.min(K_MAX, Math.min((size.w * 0.75) / (w + 80), (size.h * 0.75) / (h + 80))),
        )
        // Dead-zone: if the target is already comfortably in view at a similar
        // zoom, do not move at all. This kills the creeping second zoom when a
        // follow-up frame (for example consolidation landing) targets content
        // that is already on screen.
        try {
          const curK = fgRef.current?.zoom()
          const curC = fgRef.current?.centerAt() as { x: number; y: number } | undefined
          if (curK !== undefined && curC !== undefined) {
            const kClose = k / curK > 0.7 && k / curK < 1.45
            const shiftPx = Math.hypot((cx - curC.x) * curK, (cy - curC.y) * curK)
            const centered = shiftPx < Math.min(size.w, size.h) * 0.18
            const fitsNow =
              w * curK < size.w * 0.9 && h * curK < size.h * 0.9
            if (kClose && centered && fitsNow) return
          }
        } catch {
          /* fall through to a normal move */
        }
        moveCamera(cx, cy, k, ms)
      } catch {
        /* never fatal */
      }
    },
    [moveCamera, size],
  )

  // --- Settle controller --------------------------------------------------
  // Mental-map preservation: before reheating, pin every settled node so only
  // the newcomers move; unpin when the engine stops. A callback can be queued
  // to run on settle (that is when camera framing is allowed to happen).
  const afterSettleRef = useRef<(() => void) | null>(null)
  const pinnedRef = useRef(false)

  const settleThen = useCallback((after?: (() => void) | null, newIds?: Set<string>) => {
    for (const n of dataRef.current.nodes) {
      if (n.x !== undefined && !(newIds?.has(n.id))) {
        n.fx = n.x
        n.fy = n.y
      }
    }
    pinnedRef.current = true
    afterSettleRef.current = after ?? null
    try {
      fgRef.current?.d3ReheatSimulation()
    } catch {
      /* ignore */
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
        // No camera moves here: the first frame happens once, in onEngineStop,
        // against settled positions.
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
  }, [mergeGraph])

  // Ambient live poll: other explorers' memories drift in while you watch.
  // Paused while your own turn is animating or consolidating, so the two poll
  // loops never overlap.
  useEffect(() => {
    const id = setInterval(async () => {
      if (busyRef.current || document.hidden || stage !== 'idle') return
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
          // Local settle only (existing nodes pinned); background data NEVER
          // moves the camera.
          settleThen(null, new Set(added))
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
            addedLinks.forEach((l, j) => {
              paintRef.current.activeEdges.add(l.key)
              if (!reduced) setTimeout(() => fgRef.current?.emitParticle(l), 400 + j * 160)
            })
            // Contradictions surface HERE, not in the turn response: detection
            // happens when the fact actually stores (async extraction), which
            // is this moment. A contradicts/supersedes edge touching a fresh
            // node means one of this turn's facts overturned an older memory.
            const byId = new Map(dataRef.current.nodes.map((x) => [x.id, x]))
            for (const l of addedLinks) {
              if (l.type !== 'contradicts' && l.type !== 'supersedes') continue
              const s = endpointId(l.source)
              const t = endpointId(l.target)
              const freshId = paintRef.current.fresh.has(s) ? s : paintRef.current.fresh.has(t) ? t : null
              if (!freshId) continue
              const oldId = freshId === s ? t : s
              const oldNode = byId.get(oldId)
              if (oldNode) {
                paintRef.current.contradicted.add(oldId)
                paintRef.current.pulses.set(oldId, performance.now())
                setContradiction({ old: oldNode.content, new: byId.get(freshId)?.content ?? '' })
                setTimeout(() => setContradiction(null), 8000)
              }
            }
            // The real fact nodes have landed; retire the transient query
            // node, settle locally (existing nodes pinned), and frame ONCE
            // against settled positions, still part of the explicit turn.
            removeQueryNode()
            settleThen(
              () => frame((n) => paintRef.current.fresh.has(n.id) || paintRef.current.recalled.has(n.id)),
              new Set(added),
            )
            break
          }
        } catch {
          /* keep watching */
        }
      }
      if (submitTokenRef.current === token) {
        // Nothing extractable landed: retire the query node (nothing was
        // actually stored) and return to idle.
        removeQueryNode()
        setStage('idle')
      }
    },
    [mergeGraph, reduced, removeQueryNode, frame, settleThen],
  )

  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || busyRef.current) return
      busyRef.current = true
      setBusy(true)
      setError(null)
      setAnswer(null)
      setContradiction(null)
      setInput('')
      const token = ++submitTokenRef.current

      const paint = paintRef.current
      paint.fresh.clear()
      paint.recalled.clear()
      paint.contradicted.clear()
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
          // Mark the overturned memory ON the canvas: red, pulsing, until the
          // next turn. The alert card explains; the graph shows.
          const oldText = res.contradiction.old.trim()
          for (const n of dataRef.current.nodes) {
            if (n.content.trim() === oldText || n.content.trim().startsWith(oldText.slice(0, 80))) {
              paint.contradicted.add(n.id)
              paint.pulses.set(n.id, performance.now())
            }
          }
        }
        if (res.response) setAnswer(res.response)
        setSuggestions(pickSuggestions())
        removeQueryNode()
        mergeGraph(res)

        // Recall: the graph itself tells the story. Your words enter as a
        // glowing query node, retrieval edges draw to what the engine
        // recalled, and the camera dives in.
        setStage('recall')
        const now = performance.now()
        const recalledIds = res.recalled.map((r) => r.id).filter((id): id is string => !!id)
        const dropAt = fgRef.current?.screen2GraphCoords(size.w / 2, size.h * 0.55) ?? { x: 0, y: 0 }
        {
          // The query node ALWAYS enters, even with zero recalls, so every
          // submit visibly does something; retrieval edges draw when there are
          // memories to draw to.
          const queryId = `query-${token}`
          const { nodes, links } = dataRef.current
          const qNode: GNode = {
            id: queryId,
            content: truncate(text, 60),
            memory_type: 'query',
            x: dropAt.x,
            y: dropAt.y,
          }
          const qLinks: GLink[] = recalledIds.map((rid) => ({
            source: queryId,
            target: rid,
            type: 'recall',
            key: linkKey(queryId, rid, 'recall'),
          }))
          dataRef.current = { nodes: [...nodes, qNode], links: [...links, ...qLinks] }
          setGraphData(dataRef.current)
          recomputeDegrees()
          paint.fresh.set(queryId, now)
          paint.pulses.set(queryId, now)
          qLinks.forEach((l, i) => {
            paint.activeEdges.add(l.key)
            if (!reduced) setTimeout(() => fgRef.current?.emitParticle(l), 600 + i * 160)
          })
          for (const id of recalledIds) {
            paint.recalled.add(id)
            paint.pulses.set(id, now)
            for (const l of dataRef.current.links) {
              if (endpointId(l.source) === id || endpointId(l.target) === id) {
                paint.activeEdges.add(l.key)
              }
            }
          }
          paint.spotlight = recalledIds.length > 0
          // Explicit user action: legitimately re-take the camera, then settle
          // the query node in (everything else pinned) and frame ONCE against
          // settled positions.
          userOwnsCameraRef.current = false
          settleThen(
            () => frame((n) => paint.recalled.has(n.id) || paint.fresh.has(n.id)),
            new Set([queryId]),
          )
        }
        await delay(reduced ? 200 : recalledIds.length > 0 ? 2600 : 1200)
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
    [reduced, size, mergeGraph, removeQueryNode, frame, settleThen, watchConsolidation],
  )

  // --- canvas painting ---

  const paintNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
      // A paint exception would re-throw every animation frame and hard-freeze
      // the tab; degrade to skipping the node instead.
      try {
        paintNodeInner(node, ctx, scale)
      } catch {
        /* skip this node this frame */
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reduced],
  )

  const paintNodeInner = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
      if (!Number.isFinite(node.x ?? NaN) || !Number.isFinite(node.y ?? NaN) || !Number.isFinite(scale)) return
      const paint = paintRef.current
      const now = performance.now()
      const born = paint.fresh.get(node.id)
      const isFresh = born !== undefined
      const isRecalled = paint.recalled.has(node.id)
      const isHover = hoverRef.current?.id === node.id
      const isQuery = node.memory_type === 'query'
      const isContradicted = paint.contradicted.has(node.id)
      const dimmed = paint.spotlight && !isFresh && !isRecalled && !isContradicted && !isHover
      const degree = paint.degree.get(node.id) ?? 0
      const r = (isQuery ? 5.5 : 3.5) + Math.min(4.5, degree * 0.8) + (isFresh && !isQuery ? 1.4 : 0)
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

      let fill = '#9c9ca4'
      if (isContradicted) {
        fill = '#f87171'
      } else if (isQuery) {
        fill = '#a7f3d0'
      } else if (isFresh) {
        const t = Math.min(1, (now - (born as number)) / 1800)
        const lerp = (a: number, b: number) => Math.round(a + (b - a) * t)
        fill = `rgb(${lerp(244, 52)},${lerp(244, 211)},${lerp(245, 153)})`
      } else if (isRecalled) {
        fill = '#6ee7b7'
      }
      if (dimmed) fill = 'rgba(82,82,91,0.30)'

      if ((isFresh || isRecalled || isHover || isContradicted) && !reduced) {
        ctx.shadowColor = isContradicted ? '#f87171' : isRecalled ? '#34d399' : '#a7f3d0'
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
      const showLabel =
        (isHover || isRecalled || isFresh || isContradicted) && scale > 0.5 && fontReadyRef.current
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
        onNodeClick={(n) => {
          // Click a memory: light up its relationships, frame them, and show
          // HOW it connects (edge types + the connected memories).
          const node = n as GNode
          const paint = paintRef.current
          if (busyRef.current) return
          paint.recalled.clear()
          paint.activeEdges.clear()
          paint.recalled.add(node.id)
          paint.pulses.set(node.id, performance.now())
          const byId = new Map(dataRef.current.nodes.map((x) => [x.id, x]))
          const connections: Array<{ type: string; content: string }> = []
          for (const l of dataRef.current.links) {
            const s = endpointId(l.source)
            const t = endpointId(l.target)
            if (s === node.id || t === node.id) {
              paint.activeEdges.add(l.key)
              const otherId = s === node.id ? t : s
              paint.recalled.add(otherId)
              const other = byId.get(otherId)
              if (other) connections.push({ type: l.type, content: other.content })
            }
          }
          setFocus({ content: node.content, connections: connections.slice(0, 6) })
          paint.spotlight = true
          userOwnsCameraRef.current = false
          frame((x) => paint.recalled.has(x.id))
          setTimeout(() => {
            paint.spotlight = false
          }, 2600)
        }}
        onBackgroundClick={() => {
          const paint = paintRef.current
          paint.recalled.clear()
          paint.activeEdges.clear()
          paint.spotlight = false
          setFocus(null)
        }}
        linkColor={linkColor}
        linkWidth={(l) => (paintRef.current.activeEdges.has((l as GLink).key) ? 1.4 : 0.5)}
        linkCurvature={0.18}
        linkLineDash={(l) => ((l as GLink).type === 'recall' ? [3, 2] : null)}
        linkDirectionalParticles={(l) =>
          !reduced && paintRef.current.activeEdges.has((l as GLink).key) ? 2 : 0
        }
        linkDirectionalParticleSpeed={0.006}
        linkDirectionalParticleWidth={2.4}
        linkDirectionalParticleColor={() => '#6ee7b7'}
        warmupTicks={100}
        cooldownTicks={200}
        d3AlphaMin={0.02}
        d3AlphaDecay={0.05}
        d3VelocityDecay={0.6}
        onZoom={() => {
          // onZoom fires for programmatic moves too; only a genuine user
          // gesture takes camera sovereignty.
          if (!isProgrammaticRef.current) userOwnsCameraRef.current = true
        }}
        onZoomEnd={() => {
          isProgrammaticRef.current = false
        }}
        onNodeDragEnd={(n) => {
          // A node the user placed stays put.
          const node = n as GNode
          node.fx = node.x
          node.fy = node.y
        }}
        onEngineStop={() => {
          // Settled: release pinned nodes and run the queued camera frame (the
          // only moment framing is allowed, per the settle-then-frame rule).
          if (pinnedRef.current) {
            pinnedRef.current = false
            for (const n of dataRef.current.nodes) {
              n.fx = undefined
              n.fy = undefined
            }
          }
          const after = afterSettleRef.current
          afterSettleRef.current = null
          if (after) after()
          if (!didFitRef.current) {
            didFitRef.current = true
            frame(undefined, 700)
          }
        }}
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

      {/* how a clicked memory connects */}
      <AnimatePresence>
        {focus && (
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-4 top-16 hidden w-72 rounded-2xl border border-zinc-800 bg-zinc-950/85 p-4 backdrop-blur md:block"
          >
            <p className="text-xs font-medium leading-relaxed text-zinc-100">{truncate(focus.content, 90)}</p>
            {focus.connections.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {focus.connections.map((c, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                        c.type === 'contradicts'
                          ? 'bg-red-500/15 text-red-400'
                          : c.type === 'supersedes'
                            ? 'bg-amber-500/15 text-amber-400'
                            : c.type === 'similar'
                              ? 'bg-zinc-800 text-zinc-400'
                              : 'bg-emerald-500/10 text-emerald-400'
                      }`}
                    >
                      {c.type === 'recall' ? 'recalled with' : c.type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[11px] leading-relaxed text-zinc-400">{truncate(c.content, 72)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-zinc-500">
                No relationships yet. The engine weaves edges as related memories arrive.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* color language, quiet and always visible on md+ */}
      <div className="absolute bottom-5 left-5 hidden flex-col gap-1 text-[10px] text-zinc-500 md:flex">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400" /> recalled or new
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-400" /> contradicted
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 bg-amber-400/70" /> supersedes
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-3 bg-zinc-500" /> similar
        </span>
      </div>

      {/* re-center: the only thing that takes the camera back after you pan */}
      <button
        onClick={() => {
          userOwnsCameraRef.current = false
          frame(undefined, 600)
        }}
        className="absolute bottom-40 right-5 flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 text-xs text-zinc-400 backdrop-blur transition-colors hover:text-zinc-100"
        aria-label="Re-center the graph"
      >
        <Crosshair size={13} /> Re-center
      </button>

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

        <AnimatePresence>
          {answer && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="flex w-full max-w-2xl items-start gap-2.5 rounded-2xl border border-emerald-500/20 bg-zinc-950/85 px-4 py-3 backdrop-blur"
            >
              <span className="mt-0.5 shrink-0">
                <Logo size={16} />
              </span>
              <p className="text-sm leading-relaxed text-zinc-200">{answer}</p>
            </motion.div>
          )}
        </AnimatePresence>

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
          {suggestions.map((s) => (
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
