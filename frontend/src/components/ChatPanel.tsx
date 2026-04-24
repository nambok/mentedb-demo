import { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Zap, BookMarked } from 'lucide-react';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  memoriesUsed?: Array<{ content: string; relevance: number; type: string }>;
  contradictionDetected?: { old: string; new: string } | null;
}

interface ChatPanelProps {
  title: string;
  subtitle: string;
  messages: ChatMessage[];
  isLoading: boolean;
  accentColor: 'zinc' | 'emerald';
  model?: string;
}

function TypingMessage({ content }: { content: string }) {
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    setDisplayed(0);
    const timer = setInterval(() => {
      setDisplayed(prev => {
        if (prev >= content.length) {
          clearInterval(timer);
          return prev;
        }
        return prev + 1;
      });
    }, 12);
    return () => clearInterval(timer);
  }, [content]);

  return (
    <span>
      {content.slice(0, displayed)}
      {displayed < content.length && <span className="typing-cursor" />}
    </span>
  );
}

export default function ChatPanel({
  title,
  subtitle,
  messages,
  isLoading,
  accentColor,
  model,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMsgIndex = messages.length - 1;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  const borderClass = accentColor === 'emerald' ? 'border-emerald-500/30' : 'border-zinc-700';
  const headerBg = accentColor === 'emerald' ? 'bg-emerald-500/5' : 'bg-zinc-800/50';
  const glowClass = accentColor === 'emerald' ? 'shadow-[0_0_30px_-10px_rgba(52,211,153,0.15)]' : '';

  return (
    <div className={`flex flex-col h-full rounded-xl border ${borderClass} ${glowClass} bg-zinc-900/80 overflow-hidden`}>
      <div className={`px-4 py-3 border-b ${borderClass} ${headerBg} shrink-0`}>
        <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
        <p className="text-xs text-zinc-500">{subtitle}</p>
        {model && (
          <div className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-[10px] font-medium text-zinc-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {model}
          </div>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            Send a message to start...
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
            accentColor={accentColor}
            isLatest={i === lastMsgIndex}
          />
        ))}

        {isLoading && (
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-xs shrink-0">
              AI
            </div>
            <div className="bg-zinc-800 rounded-lg px-4 py-2">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  accentColor,
  isLatest,
}: {
  message: ChatMessage;
  accentColor: 'zinc' | 'emerald';
  isLatest: boolean;
}) {
  const [memoriesExpanded, setMemoriesExpanded] = useState(false);
  const isUser = message.role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 ${
          isUser ? 'bg-blue-600 text-white' : accentColor === 'emerald' ? 'bg-emerald-600 text-white' : 'bg-zinc-700 text-zinc-300'
        }`}
      >
        {isUser ? 'U' : 'AI'}
      </div>

      <div className={`max-w-[85%] space-y-2`}>
        {message.contradictionDetected && (
          <div className="flex items-center gap-2 text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-1.5 text-amber-400">
            <Zap size={14} />
            <span>
              Contradiction: "{message.contradictionDetected.old}" → "{message.contradictionDetected.new}"
            </span>
          </div>
        )}

        {message.memoriesUsed && message.memoriesUsed.length > 0 && (
          <button
            onClick={() => setMemoriesExpanded(!memoriesExpanded)}
            className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
          >
            <BookMarked size={12} />
            <span>{message.memoriesUsed.length} memories recalled</span>
            {memoriesExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}

        {memoriesExpanded && message.memoriesUsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="space-y-1 overflow-hidden"
          >
            {message.memoriesUsed.map((m, j) => (
              <div key={j} className="text-xs bg-emerald-500/5 border border-emerald-500/20 rounded px-2 py-1 text-emerald-300/80">
                📌 {m.content.slice(0, 80)}... <span className="text-emerald-500/60">[{m.relevance.toFixed(2)}]</span>
              </div>
            ))}
          </motion.div>
        )}

        <div
          className={`rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'bg-blue-600 text-white'
              : accentColor === 'emerald'
              ? 'bg-zinc-800 border border-emerald-500/10 text-zinc-200'
              : 'bg-zinc-800 text-zinc-300'
          }`}
        >
          {!isUser && isLatest ? (
            <TypingMessage content={message.content} />
          ) : (
            <span className="whitespace-pre-wrap">{message.content}</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
