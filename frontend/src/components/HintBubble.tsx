import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb, X } from 'lucide-react';

interface HintBubbleProps {
  text: string;
  visible: boolean;
  onDismiss: () => void;
}

export default function HintBubble({ text, visible, onDismiss }: HintBubbleProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="flex items-start gap-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-4 py-3 text-sm text-emerald-200"
        >
          <Lightbulb size={16} className="text-emerald-400 shrink-0 mt-0.5" />
          <span className="flex-1">{text}</span>
          <button
            onClick={onDismiss}
            className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
          >
            <X size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
