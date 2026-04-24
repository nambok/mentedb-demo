import { motion, AnimatePresence } from 'framer-motion';
import { Brain, ArrowDown, ArrowUp, Zap, BarChart3 } from 'lucide-react';

interface MemoryFeedProps {
  memoriesUsed: Array<{ content: string; relevance: number; type: string }>;
  memoriesStored: Array<{ content: string; type: string }>;
  contradiction: { old: string; new: string } | null;
  totalMemories: number;
  avgHealth: number;
}

export default function MemoryFeed({
  memoriesUsed,
  memoriesStored,
  contradiction,
  totalMemories,
  avgHealth,
}: MemoryFeedProps) {
  const hasActivity = memoriesUsed.length > 0 || memoriesStored.length > 0 || contradiction;

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
                  <span className="mr-1">📌</span>
                  {m.content.slice(0, 100)}{m.content.length > 100 ? '...' : ''}
                  <span className="ml-2 text-emerald-500/60">[{m.relevance.toFixed(2)}]</span>
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
                  {m.content.slice(0, 100)}{m.content.length > 100 ? '...' : ''}
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
