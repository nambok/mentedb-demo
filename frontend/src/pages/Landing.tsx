import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { MessageSquare, Share2, ArrowRight } from 'lucide-react'

function GithubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.25 5.69.41.35.78 1.05.78 2.12v3.14c0 .3.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// demo.mentedb.com index: pick between the chat demo and the graph explorer.
// Each card is a live, moving preview that wakes up on hover, not a screenshot.
// ---------------------------------------------------------------------------

const CHAT_LOOP: Array<{ role: 'user' | 'ai'; text: string }> = [
  { role: 'user', text: 'I switched to Postgres last month' },
  { role: 'ai', text: 'Noted. I will remember your stack.' },
  { role: 'user', text: 'What database do I use?' },
  { role: 'ai', text: 'Postgres, since last month.' },
]

function MiniChatPreview({ active }: { active: boolean }) {
  const [visible, setVisible] = useState(1)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (reduced) {
      setVisible(CHAT_LOOP.length)
      return
    }
    const id = setInterval(
      () => setVisible((v) => (v >= CHAT_LOOP.length ? 1 : v + 1)),
      active ? 1100 : 2200,
    )
    return () => clearInterval(id)
  }, [active, reduced])

  return (
    <div className="flex h-full flex-col justify-end gap-2 overflow-hidden p-5">
      {CHAT_LOOP.slice(0, visible).map((m, i) => (
        <motion.div
          key={`${i}-${m.text}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className={`max-w-[85%] rounded-xl px-3 py-1.5 text-[11px] leading-relaxed ${
            m.role === 'user'
              ? 'self-end bg-zinc-800 text-zinc-200'
              : 'self-start border border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-200/90'
          }`}
        >
          {m.text}
        </motion.div>
      ))}
    </div>
  )
}

// A small decorative constellation that drifts; pure SVG, no physics engine.
const MINI_NODES = [
  { x: 30, y: 42, r: 4.5, hot: true },
  { x: 62, y: 22, r: 3 },
  { x: 78, y: 55, r: 3.5, hot: true },
  { x: 48, y: 72, r: 2.6 },
  { x: 16, y: 70, r: 2.4 },
  { x: 88, y: 30, r: 2.2 },
  { x: 55, y: 45, r: 3.2 },
  { x: 20, y: 18, r: 2.4 },
]
const MINI_EDGES: Array<[number, number]> = [
  [0, 6], [6, 2], [6, 1], [0, 4], [0, 7], [2, 5], [3, 6], [3, 4],
]

function MiniGraphPreview({ active }: { active: boolean }) {
  const reduced = useReducedMotion()
  const dur = active ? 5 : 10
  return (
    <div className="relative h-full w-full overflow-hidden">
      <svg viewBox="0 0 100 90" className="h-full w-full">
        {MINI_EDGES.map(([a, b], i) => (
          <line
            key={i}
            x1={MINI_NODES[a].x}
            y1={MINI_NODES[a].y}
            x2={MINI_NODES[b].x}
            y2={MINI_NODES[b].y}
            stroke={active ? 'rgba(52,211,153,0.35)' : 'rgba(113,113,122,0.25)'}
            strokeWidth="0.4"
          />
        ))}
        {MINI_NODES.map((n, i) => (
          <motion.circle
            key={i}
            cx={n.x}
            cy={n.y}
            r={n.r}
            fill={n.hot ? '#34d399' : '#71717a'}
            opacity={n.hot ? 0.95 : 0.7}
            animate={
              reduced
                ? undefined
                : { cx: [n.x, n.x + (i % 2 ? 2.5 : -2.5), n.x], cy: [n.y, n.y + (i % 3 ? -2 : 2), n.y] }
            }
            transition={{ duration: dur + i, repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
        {/* one slow particle along the main edge when awake */}
        {active && !reduced && (
          <motion.circle
            r="0.9"
            fill="#6ee7b7"
            animate={{
              cx: [MINI_NODES[0].x, MINI_NODES[6].x, MINI_NODES[2].x],
              cy: [MINI_NODES[0].y, MINI_NODES[6].y, MINI_NODES[2].y],
            }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
          />
        )}
      </svg>
    </div>
  )
}

function DemoCard({
  to,
  icon,
  title,
  blurb,
  preview,
}: {
  to: string
  icon: React.ReactNode
  title: string
  blurb: string
  preview: (active: boolean) => React.ReactNode
}) {
  const [hover, setHover] = useState(false)
  return (
    <motion.div
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      whileHover={{ y: -6, scale: 1.02 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link
        to={to}
        className={`group block overflow-hidden rounded-2xl border bg-zinc-900/40 backdrop-blur transition-colors ${
          hover ? 'border-emerald-500/40' : 'border-zinc-800'
        }`}
      >
        <div className="h-52 border-b border-zinc-800/60 bg-zinc-950/60">{preview(hover)}</div>
        <div className="p-6">
          <div className="flex items-center gap-2.5">
            <span className="text-emerald-400">{icon}</span>
            <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">{blurb}</p>
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400">
            Open demo
            <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </Link>
    </motion.div>
  )
}

export default function Landing() {
  return (
    <div className="relative min-h-screen bg-zinc-950 text-zinc-100">
      {/* layered backdrop: dot grid, center glow, vignette */}
      <div className="pointer-events-none absolute inset-0 bg-dotgrid" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 45% at 50% 35%, rgba(16,185,129,0.07), transparent 70%)',
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.5))' }}
        aria-hidden
      />

      <div className="relative mx-auto flex min-h-screen max-w-4xl flex-col px-6">
        <header className="flex items-center justify-between py-8">
          <a href="https://mentedb.com" className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500 font-bold text-zinc-950">
              M
            </span>
            MenteDB
          </a>
          <a
            href="https://github.com/nambok/mentedb"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          >
            <GithubIcon size={14} /> Open source
          </a>
        </header>

        <main className="flex flex-1 flex-col justify-center pb-24">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="mb-12 text-center"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Live demos, no signup
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Watch an AI actually remember
            </h1>
            <p className="mx-auto mt-3 max-w-md text-zinc-400">
              Two ways to see MenteDB think. Both run on the real engine, live.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
            className="grid gap-6 sm:grid-cols-2"
          >
            <DemoCard
              to="/chat"
              icon={<MessageSquare size={19} />}
              title="Memory Chat"
              blurb="Talk to an assistant that remembers you across sessions, corrects itself, and shows every memory it uses."
              preview={(active) => <MiniChatPreview active={active} />}
            />
            <DemoCard
              to="/graph"
              icon={<Share2 size={19} />}
              title="Graph Explorer"
              blurb="Type anything and watch it break into facts, join a living knowledge graph, and pull related memories back out."
              preview={(active) => <MiniGraphPreview active={active} />}
            />
          </motion.div>
        </main>

        <footer className="pb-6 text-center text-xs text-zinc-600">
          Every session is isolated. Memories you create here are yours alone and expire nightly.
        </footer>
      </div>
    </div>
  )
}
