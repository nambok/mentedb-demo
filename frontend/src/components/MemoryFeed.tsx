import { motion, AnimatePresence } from 'framer-motion';
import { Brain, ArrowDown, ArrowUp, Zap, BarChart3, ShieldAlert, Sparkles, Activity } from 'lucide-react';

interface MemoryFeedProps {
  memoriesUsed: Array<{ content: string; relevance: number; type: string; is_new?: boolean; from_cache?: boolean; health?: number; scope?: string; tags?: string[] }>;
  memoriesStored: Array<{ content: string; type: string }>;
  contradiction: { old: string; new: string } | null;
  painWarnings: Array<{ signal_id?: string; description?: string; intensity?: number }>;
  proactiveRecalls: Array<{ trigger: string; reason: string; memories: Array<{ summary: string }> }>;
  detectedActions: Array<{ type: string; detail: string }>;
  totalMemories: number;
  avgHealth: number;
}

export default function MemoryFeed({
  memoriesUsed,
  memoriesStored,
  contradiction,
  painWarnings,
  proactiveRecalls,
  detectedActions,
  totalMemories,
  avgHealth,
}: MemoryFeedProps) {
  const hasActivity = memoriesUsed.length > 0 || memoriesStored.length > 0 || contradiction || painWarnings.length > 0 || proactiveRecalls.length > 0 || detectedActions.length > 0;

  return (
    <div className="flex flex-col h-full rounded-xl border border-zinc-800 bg-zinc-900/80 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-800/50 shrink-0 flex items-center gap-2">
        <Brain size={16} className="text-emerald-400" />
        <h2 className="text-sm font-semibold text-zinc-100">Memory Activity</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 min-h-0">
        {!hasActivity && (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600 text-xs text-center gap-2 px-4">
            <Brain size={24} className="text-zinc-700" />
            <p>Memory activity will appear here as you chat with the MenteDB panel</p>
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {memoriesUsed.length > 0 && (
            <motion.div
              key="recalled"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                <ArrowUp size={12} />
                RECALLED
              </div>
              {memoriesUsed.map((m, i) => (
                <motion.div
                  key={`recalled-${i}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="text-xs bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2 text-zinc-300"
                >
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-emerald-400/60">[{m.type}]</span>
                    {m.is_new && <span className="px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-medium">NEW</span>}
                    {m.from_cache && <span className="px-1 py-0.5 rounded bg-yellow-500/20 text-yellow-300 text-[9px] font-medium">CACHED</span>}
                    {m.scope === 'always' && <span className="px-1 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[9px] font-medium">ALWAYS</span>}
                  </div>
                  {(m.content ?? '').slice(0, 120)}{(m.content ?? '').length > 120 ? '...' : ''}
                  <span className="ml-2 text-emerald-500/60">[{(m.relevance ?? 0).toFixed(2)}]</span>
                </motion.div>
              ))}
            </motion.div>
          )}

          {memoriesStored.length > 0 && (
            <motion.div
              key="stored"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-blue-400">
                <ArrowDown size={12} />
                STORED
              </div>
              {memoriesStored.map((m, i) => (
                <motion.div
                  key={`stored-${i}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="text-xs bg-blue-500/5 border border-blue-500/20 rounded-lg px-3 py-2 text-zinc-300"
                >
                  <span className="mr-1">💾</span>
                  {(m.content ?? '').slice(0, 100)}{(m.content ?? '').length > 100 ? '...' : ''}
                  <span className="ml-2 text-blue-400/60">[{m.type}]</span>
                </motion.div>
              ))}
            </motion.div>
          )}

          {contradiction && (
            <motion.div
              key="contradiction"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
                <Zap size={12} />
                CONTRADICTION
              </div>
              <div className="text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-amber-300">
                "{contradiction.old}" → "{contradiction.new}"
              </div>
            </motion.div>
          )}

          {painWarnings.length > 0 && (
            <motion.div
              key="pain"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-red-400">
                <ShieldAlert size={12} />
                PAIN SIGNALS
              </div>
              {painWarnings.map((p, i) => (
                <motion.div
                  key={`pain-${i}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-red-300"
                >
                  {p.description ?? 'Pain signal detected'}
                  {p.intensity != null && (
                    <span className="ml-2 text-red-400/60">[intensity: {p.intensity}]</span>
                  )}
                </motion.div>
              ))}
            </motion.div>
          )}

          {proactiveRecalls.length > 0 && (
            <motion.div
              key="proactive"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-purple-400">
                <Sparkles size={12} />
                PROACTIVE RECALL
              </div>
              {proactiveRecalls.map((r, i) => (
                <motion.div
                  key={`proactive-${i}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="text-xs bg-purple-500/10 border border-purple-500/20 rounded-lg px-3 py-2 text-purple-300"
                >
                  <div className="text-purple-400/80 mb-1">{r.reason}</div>
                  {r.memories.map((m, j) => (
                    <div key={j} className="text-zinc-400 ml-2">• {(m.summary ?? '').slice(0, 80)}</div>
                  ))}
                </motion.div>
              ))}
            </motion.div>
          )}

          {detectedActions.length > 0 && (
            <motion.div
              key="actions"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-cyan-400">
                <Activity size={12} />
                DETECTED ACTIONS
              </div>
              {detectedActions.map((a, i) => (
                <motion.div
                  key={`action-${i}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="text-xs bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-3 py-2 text-cyan-300"
                >
                  <span className="font-medium">{a.type}</span>: {a.detail}
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-800/30 shrink-0">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <div className="flex items-center gap-1.5">
            <BarChart3 size={12} />
            <span>{totalMemories} memories</span>
          </div>
          <span>{avgHealth > 0 ? `${Math.round(avgHealth * 100)}% health` : '—'}</span>
        </div>
      </div>
    </div>
  );
}
