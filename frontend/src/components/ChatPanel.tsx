import { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Zap, BookMarked, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'session-break';
  content: string;
  memoriesUsed?: Array<{ content: string; relevance: number; type: string }>;
  contradictionDetected?: { old: string; new: string } | null;
  counterfactual?: string;
}

interface ChatPanelProps {
  title: string;
  subtitle: string;
  messages: ChatMessage[];
  isLoading: boolean;
  accentColor: 'zinc' | 'emerald';
  model?: string;
  sessionNumber?: number;
}

function TypingMarkdown({ content }: { content: string }) {
  const text = content ?? '';
  const [displayed, setDisplayed] = useState(0);
  const done = displayed >= text.length;

  useEffect(() => {
    setDisplayed(0);
    const chunkSize = Math.max(3, Math.floor(text.length / 60));
    const timer = setInterval(() => {
      setDisplayed(prev => {
        if (prev >= text.length) {
          clearInterval(timer);
          return text.length;
        }
        return Math.min(prev + chunkSize, text.length);
      });
    }, 8);
    return () => clearInterval(timer);
  }, [text]);

  if (done) {
    return (
      <div className="prose-chat">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    );
  }

  return (
    <span>
      {text.slice(0, displayed)}
      <span className="typing-cursor" />
    </span>
  );
}

export default function ChatPanel({
  title,
  subtitle,
  messages,
  isLoading,
  model,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMsgIndex = messages.length - 1;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  return (
    <div className="flex flex-col h-full rounded-xl border border-emerald-500/30 shadow-[0_0_30px_-10px_rgba(52,211,153,0.15)] bg-zinc-900/80 overflow-hidden">
      <div className="px-4 py-3 border-b border-emerald-500/30 bg-emerald-500/5 shrink-0">
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

        {messages.map((msg, i) => {
          if (msg.role === 'session-break') {
            return <SessionBreakDivider key={i} />;
          }
          if (msg.role === 'user') {
            return <UserBubble key={i} content={msg.content} />;
          }
          return (
            <ComparisonCard
              key={i}
              message={msg}
              isLatest={i === lastMsgIndex}
            />
          );
        })}

        {isLoading && (
          <div className="flex gap-3">
            <div className="flex-1 rounded-lg bg-zinc-800/50 border border-zinc-700/50 px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-zinc-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-zinc-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-zinc-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
            <div className="flex-1 rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex justify-end"
    >
      <div className="flex items-start gap-3 flex-row-reverse max-w-[80%]">
        <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs text-white shrink-0">U</div>
        <div className="rounded-lg px-4 py-2.5 text-sm leading-relaxed bg-blue-600 text-white">
          <span className="whitespace-pre-wrap">{content}</span>
        </div>
      </div>
    </motion.div>
  );
}

function SessionBreakDivider() {
  return (
    <motion.div
      initial={{ opacity: 0, scaleX: 0.8 }}
      animate={{ opacity: 1, scaleX: 1 }}
      className="flex items-center gap-3 py-4"
    >
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/30">
        <RefreshCw size={13} className="text-amber-400" />
        <span className="text-xs font-semibold text-amber-300">New Session — chat history cleared, memories persist</span>
      </div>
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
    </motion.div>
  );
}

function ComparisonCard({
  message,
  isLatest,
}: {
  message: ChatMessage;
  isLatest: boolean;
}) {
  const [memoriesExpanded, setMemoriesExpanded] = useState(false);
  const withMemory = message.content ?? '';
  const withoutMemory = message.counterfactual ?? '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-2"
    >
      {/* Contradiction badge */}
      {message.contradictionDetected && (
        <div className="flex items-center gap-2 text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-1.5 text-amber-400">
          <Zap size={14} />
          <span>Contradiction: "{message.contradictionDetected.old}" → "{message.contradictionDetected.new}"</span>
        </div>
      )}

      {/* Memories recalled badge */}
      {message.memoriesUsed && message.memoriesUsed.length > 0 && (
        <>
          <button
            onClick={() => setMemoriesExpanded(!memoriesExpanded)}
            className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
          >
            <BookMarked size={12} />
            <span>{message.memoriesUsed.length} memories recalled</span>
            {memoriesExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {memoriesExpanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="space-y-1 overflow-hidden">
              {message.memoriesUsed.map((m, j) => (
                <div key={j} className="text-xs bg-emerald-500/5 border border-emerald-500/20 rounded px-2 py-1 text-emerald-300/80">
                  📌 {(m.content ?? '').slice(0, 80)}… <span className="text-emerald-500/60">[{(m.relevance ?? 0).toFixed(2)}]</span>
                </div>
              ))}
            </motion.div>
          )}
        </>
      )}

      {/* Side-by-side response comparison */}
      <div className="grid grid-cols-2 gap-2">
        {/* Without MenteDB */}
        <div className="rounded-lg border border-zinc-700/60 bg-zinc-800/60 overflow-hidden">
          <div className="px-3 py-1.5 border-b border-zinc-700/40 bg-zinc-800/80 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-zinc-500" />
            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Without Memory</span>
          </div>
          <div className="px-3 py-2.5 text-sm leading-relaxed text-zinc-400">
            {withoutMemory ? (
              <div className="prose-chat prose-chat-dim">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{withoutMemory}</ReactMarkdown>
              </div>
            ) : (
              <span className="text-zinc-600 italic text-xs">Loading...</span>
            )}
          </div>
        </div>

        {/* With MenteDB */}
        <div className="rounded-lg border border-emerald-500/30 bg-zinc-800/80 overflow-hidden shadow-[0_0_15px_-5px_rgba(52,211,153,0.1)]">
          <div className="px-3 py-1.5 border-b border-emerald-500/20 bg-emerald-500/5 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">With MenteDB</span>
          </div>
          <div className="px-3 py-2.5 text-sm leading-relaxed text-zinc-200">
            {isLatest ? (
              <TypingMarkdown content={withMemory} />
            ) : (
              <div className="prose-chat">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{withMemory}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
