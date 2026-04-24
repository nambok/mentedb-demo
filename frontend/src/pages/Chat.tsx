import { useState, useEffect, useCallback, useRef } from 'react';
import { Send } from 'lucide-react';
import ChatPanel, { type ChatMessage } from '../components/ChatPanel';
import MemoryFeed from '../components/MemoryFeed';
import ScenarioPlayer from '../components/ScenarioPlayer';
import Header from '../components/Header';
import { sendChat, resetSession, seedPersona, getMemories } from '../lib/api';
import { personaScenarios } from '../data/scenarios';

export default function Chat() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [mode, setMode] = useState<'free' | 'guided'>('guided');
  const [selectedPersona, setSelectedPersona] = useState('developer');
  const [scenarioStep, setScenarioStep] = useState(0);

  // Single message list (includes session-break markers)
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Track which session we're in (1-based). Session breaks increment this.
  const [sessionNumber, setSessionNumber] = useState(1);


  // Cognitive feed state
  const [memoriesUsed, setMemoriesUsed] = useState<Array<{ content: string; relevance: number; type: string; is_new?: boolean; from_cache?: boolean; health?: number; scope?: string; tags?: string[] }>>([]);
  const [memoriesStored, setMemoriesStored] = useState<Array<{ content: string; type: string }>>([]);
  const [contradiction, setContradiction] = useState<{ old: string; new: string } | null>(null);
  const [painWarnings, setPainWarnings] = useState<Array<{ signal_id?: string; description?: string; intensity?: number }>>([]);
  const [proactiveRecalls, setProactiveRecalls] = useState<Array<{ trigger: string; reason: string; memories: Array<{ summary: string }> }>>([]);
  const [detectedActions, setDetectedActions] = useState<Array<{ type: string; detail: string }>>([]);
  const [totalMemories, setTotalMemories] = useState(0);
  const [avgHealth, setAvgHealth] = useState(0);
  const [modelName, setModelName] = useState<string>('Amazon Nova Lite');

  const [input, setInput] = useState('');
  const [turnCount, setTurnCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Seed persona on mount
  useEffect(() => {
    if (selectedPersona !== 'fresh') {
      seedPersona(sessionId, selectedPersona).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update memory stats after each turn
  useEffect(() => {
    getMemories(sessionId).then(mems => {
      setTotalMemories(mems.length);
      if (mems.length > 0) {
        setAvgHealth(mems.reduce((sum, m) => sum + m.health, 0) / mems.length);
      }
    }).catch(() => {});
  }, [turnCount, sessionId]);

  // Get only messages from the current session (after the last session break)
  const getCurrentSessionHistory = useCallback(() => {
    const allMsgs = [...messages];
    let lastBreakIdx = -1;
    for (let i = allMsgs.length - 1; i >= 0; i--) {
      if (allMsgs[i].role === 'session-break') {
        lastBreakIdx = i;
        break;
      }
    }
    return allMsgs
      .slice(lastBreakIdx + 1)
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setInput('');

    const history = [...getCurrentSessionHistory(), { role: 'user' as const, content: text.trim() }];

    try {
      // Fire main (with_memory) request + counterfactual (without_memory) in parallel
      const [mainResult, counterfactualResult] = await Promise.allSettled([
        sendChat({ messages: history, session_id: sessionId, mode: 'with_memory' }),
        // Counterfactual: only the current message, no history, no memory
        sendChat({ messages: [{ role: 'user', content: text.trim() }], session_id: sessionId, mode: 'without_memory' }),
      ]);

      let assistantContent = '';
      let counterfactual: string | undefined;

      if (mainResult.status === 'fulfilled') {
        const r = mainResult.value;
        assistantContent = r.response ?? '';
        setMemoriesUsed(r.memories_used || []);
        setMemoriesStored(r.memories_stored || []);
        setContradiction(r.contradiction_detected || null);
        setPainWarnings(r.pain_warnings || []);
        setProactiveRecalls(r.proactive_recalls || []);
        setDetectedActions(r.detected_actions || []);
        if (r.model) setModelName(r.model);
      } else {
        assistantContent = '❌ Error: ' + (mainResult.reason as Error).message;
      }

      if (counterfactualResult.status === 'fulfilled') {
        counterfactual = counterfactualResult.value.response ?? '';
      }

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: assistantContent,
          memoriesUsed: mainResult.status === 'fulfilled' ? mainResult.value.memories_used : undefined,
          contradictionDetected: mainResult.status === 'fulfilled' ? mainResult.value.contradiction_detected : undefined,
          counterfactual,
        },
      ]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❌ Error: ' + (err as Error).message }]);
    }

    setIsLoading(false);
    const newTurn = turnCount + 1;
    setTurnCount(newTurn);

    if (mode === 'guided') {
      setScenarioStep(prev => prev + 1);
    }
  }, [getCurrentSessionHistory, sessionId, turnCount, mode]);

  const handleSessionBreak = useCallback(() => {
    const newSessionNum = sessionNumber + 1;
    setSessionNumber(newSessionNum);
    setMessages(prev => [
      ...prev,
      { role: 'session-break', content: `Session ${newSessionNum}` },
    ]);
    if (mode === 'guided') {
      setScenarioStep(prev => prev + 1);
    }
  }, [sessionNumber, mode]);

  const handleReset = useCallback(async () => {
    await resetSession(sessionId).catch(() => {});
    setMessages([]);
    setMemoriesUsed([]);
    setMemoriesStored([]);
    setContradiction(null);
    setPainWarnings([]);
    setProactiveRecalls([]);
    setDetectedActions([]);
    setTotalMemories(0);
    setAvgHealth(0);
    setTurnCount(0);
    setScenarioStep(0);
    setSessionNumber(1);
    if (selectedPersona !== 'fresh') {
      await seedPersona(sessionId, selectedPersona).catch(() => {});
    }
  }, [sessionId, selectedPersona]);

  const handlePersonaChange = useCallback(async (id: string) => {
    setSelectedPersona(id);
    setMessages([]);
    setMemoriesUsed([]);
    setMemoriesStored([]);
    setContradiction(null);
    setPainWarnings([]);
    setProactiveRecalls([]);
    setDetectedActions([]);
    setScenarioStep(0);
    setTurnCount(0);
    setSessionNumber(1);
    await resetSession(sessionId).catch(() => {});
    if (id !== 'fresh') {
      await seedPersona(sessionId, id).catch(() => {});
    }
  }, [sessionId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const scenario = personaScenarios[selectedPersona] ?? personaScenarios.developer;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        sessionId={sessionId}
        selectedPersona={selectedPersona}
        onSelectPersona={handlePersonaChange}
        mode={mode}
        onToggleMode={() => setMode(m => (m === 'free' ? 'guided' : 'free'))}
        onReset={handleReset}
      />

      {/* Main content area */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3 p-3">
        {/* Chat panel — single */}
        <div className="flex-1 min-h-0">
          <ChatPanel
            title="Chat with MenteDB"
            subtitle="AI with persistent memory across sessions"
            messages={messages}
            isLoading={isLoading}
            accentColor="emerald"
            model={modelName}
            sessionNumber={sessionNumber}
          />
        </div>

        {/* Memory feed sidebar */}
        <div className="w-full lg:w-72 xl:w-80 shrink-0 h-48 lg:h-auto">
          <MemoryFeed
            memoriesUsed={memoriesUsed}
            memoriesStored={memoriesStored}
            contradiction={contradiction}
            painWarnings={painWarnings}
            proactiveRecalls={proactiveRecalls}
            detectedActions={detectedActions}
            totalMemories={totalMemories}
            avgHealth={avgHealth}
          />
        </div>
      </div>

      {/* Bottom controls */}
      <div className="shrink-0 p-3 space-y-3 border-t border-zinc-800">
        {mode === 'guided' && (
          <ScenarioPlayer
            scenario={scenario}
            currentStep={scenarioStep}
            onSendStep={sendMessage}
            onSessionBreak={handleSessionBreak}
            isLoading={isLoading}
          />
        )}

        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={mode === 'guided' ? "Use the scenario player above, or type your own message..." : "Type a message..."}
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
          >
            <Send size={14} />
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
