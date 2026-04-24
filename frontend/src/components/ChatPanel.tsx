import { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Zap, BookMarked, RefreshCw, EyeOff } from 'lucide-react';
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

        {messages.map((msg, i) => {
          if (msg.role === 'session-break') {
            return <SessionBreakDivider key={i} label={msg.content} />;
          }
          return (
            <MessageBubble
              key={i}
              message={msg}
              accentColor={accentColor}
              isLatest={i === lastMsgIndex}
            />
          );
        })}

        {isLoading && (
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-emerald-600 flex items-center justify-center text-xs text-white shrink-0">
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

function SessionBreakDivider({ label: _label }: { label: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scaleX: 0.8 }}
      animate={{ opacity: 1, scaleX: 1 }}
      className="flex items-center gap-3 py-3"
    >
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
        <RefreshCw size={12} className="text-emerald-400" />
        <span className="text-xs font-medium text-emerald-300">✨ New Session — chat history cleared, memories persist</span>
      </div>
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
    </motion.div>
  );
}

function CounterfactualCard({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = (text ?? '').slice(0, 120);

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="mt-2"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-400 transition-colors cursor-pointer group"
      >
        <EyeOff size={12} />
        <span className="font-medium">Without MenteDB</span>
        <span className="text-zinc-600 group-hover:text-zinc-500">
          {expanded ? '▾' : '▸'} {!expanded && `"${preview}${text.length > 120 ? '...' : ''}"`}
        </span>
      </button>
      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="mt-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50 px-4 py-2.5 text-sm text-zinc-500 leading-relaxed overflow-hidden"
        >
          <div className="prose-chat opacity-60">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function MessageBubble({
  message,
  accentColor: _accentColor,
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
          isUser ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white'
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
                📌 {(m.content ?? '').slice(0, 80)}... <span className="text-emerald-500/60">[{(m.relevance ?? 0).toFixed(2)}]</span>
              </div>
            ))}
          </motion.div>
        )}

        <div
          className={`rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'bg-blue-600 text-white'
              : 'bg-zinc-800 border border-emerald-500/10 text-zinc-200'
          }`}
        >
          {!isUser && isLatest ? (
            <TypingMarkdown content={message.content ?? ''} />
          ) : isUser ? (
            <span className="whitespace-pre-wrap">{message.content ?? ''}</span>
          ) : (
            <div className="prose-chat">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content ?? ''}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* Counterfactual comparison — only for assistant messages */}
        {!isUser && message.counterfactual && (
          <CounterfactualCard text={message.counterfactual} />
        )}
      </div>
    </motion.div>
  );
}
