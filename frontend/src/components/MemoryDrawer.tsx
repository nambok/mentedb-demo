import { motion, AnimatePresence } from 'framer-motion';
import { X, Brain, Tag, Shield, AlertTriangle, Lightbulb, BookOpen, Wrench } from 'lucide-react';
import type { Memory } from '../lib/api';

interface MemoryDrawerProps {
  open: boolean;
  onClose: () => void;
  memories: Memory[];
  personaLabel: string;
}

const TYPE_CONFIG: Record<string, { icon: typeof Brain; color: string; label: string }> = {
  semantic: { icon: Lightbulb, color: 'text-blue-400 bg-blue-400/10 border-blue-400/30', label: 'Semantic' },
  episodic: { icon: BookOpen, color: 'text-purple-400 bg-purple-400/10 border-purple-400/30', label: 'Episodic' },
  procedural: { icon: Wrench, color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30', label: 'Procedural' },
  anti_pattern: { icon: AlertTriangle, color: 'text-amber-400 bg-amber-400/10 border-amber-400/30', label: 'Anti-pattern' },
  correction: { icon: Shield, color: 'text-red-400 bg-red-400/10 border-red-400/30', label: 'Correction' },
  reasoning: { icon: Brain, color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', label: 'Reasoning' },
};

const DEFAULT_TYPE = { icon: Brain, color: 'text-zinc-400 bg-zinc-400/10 border-zinc-400/30', label: 'Memory' };

export default function MemoryDrawer({ open, onClose, memories, personaLabel }: MemoryDrawerProps) {
  const typeCounts = memories.reduce<Record<string, number>>((acc, m) => {
    acc[m.memory_type] = (acc[m.memory_type] || 0) + 1;
    return acc;
  }, {});

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 z-40"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-zinc-900 border-l border-zinc-700 z-50 flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                  <Brain size={18} className="text-emerald-400" />
                  Memory Bank
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {memories.length} memories pre-loaded for <span className="text-emerald-400">{personaLabel}</span>
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Type summary chips */}
            <div className="px-5 py-3 border-b border-zinc-800/50 flex flex-wrap gap-1.5">
              {Object.entries(typeCounts).map(([type, count]) => {
                const cfg = TYPE_CONFIG[type] || DEFAULT_TYPE;
                return (
                  <span key={type} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${cfg.color}`}>
                    {cfg.label} ({count})
                  </span>
                );
              })}
            </div>

            {/* Memory list */}
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              {memories.map((mem, i) => {
                const cfg = TYPE_CONFIG[mem.memory_type] || DEFAULT_TYPE;
                const Icon = cfg.icon;
                return (
                  <motion.div
                    key={mem.id || i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className="rounded-lg border border-zinc-800 bg-zinc-800/40 p-3 space-y-2"
                  >
                    <div className="flex items-start gap-2">
                      <Icon size={14} className={cfg.color.split(' ')[0]} />
                      <p className="text-sm text-zinc-200 leading-relaxed flex-1">{mem.content}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${cfg.color}`}>
                        {cfg.label}
                      </span>
                      {mem.tags?.map(tag => (
                        <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-zinc-500 bg-zinc-800 border border-zinc-700">
                          <Tag size={8} />
                          {tag}
                        </span>
                      ))}
                      {mem.health != null && (
                        <span className="text-[10px] text-zinc-600 ml-auto">
                          health: {mem.health.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </motion.div>
                );
              })}

              {memories.length === 0 && (
                <div className="text-center text-zinc-600 text-sm py-8">
                  No memories loaded. Select a persona to see pre-seeded memories.
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-zinc-800 text-[11px] text-zinc-600 shrink-0">
              These memories were pre-loaded to simulate a returning user. In production, MenteDB learns from real conversations.
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
