import { useState, useEffect, useCallback, useRef } from 'react';
import { Send } from 'lucide-react';
import ChatPanel, { type ChatMessage } from '../components/ChatPanel';
import MemoryFeed from '../components/MemoryFeed';
import HintBubble from '../components/HintBubble';
import ScenarioPlayer from '../components/ScenarioPlayer';
import Header from '../components/Header';
import { sendChat, resetSession, seedPersona, getMemories } from '../lib/api';
import { scenarios, type Scenario } from '../data/scenarios';

const FREE_MODE_HINTS: Record<number, string> = {
  1: "💡 Try asking about your tech stack — the right panel knows your preferences",
  3: "💡 Try contradicting something you said earlier",
  5: "💡 Click Reset to clear history but keep memories",
  7: "💡 Ask for a recommendation based on everything discussed",
};

export default function Chat() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [mode, setMode] = useState<'free' | 'guided'>('guided');
  const [selectedScenario, setSelectedScenario] = useState<Scenario>(scenarios[0]);
  const [scenarioStep, setScenarioStep] = useState(0);
  const [selectedPersona, setSelectedPersona] = useState('developer');

  const [leftMessages, setLeftMessages] = useState<ChatMessage[]>([]);
  const [rightMessages, setRightMessages] = useState<ChatMessage[]>([]);
  const [leftLoading, setLeftLoading] = useState(false);
  const [rightLoading, setRightLoading] = useState(false);

  const [memoriesUsed, setMemoriesUsed] = useState<Array<{ content: string; relevance: number; type: string }>>([]);
  const [memoriesStored, setMemoriesStored] = useState<Array<{ content: string; type: string }>>([]);
  const [contradiction, setContradiction] = useState<{ old: string; new: string } | null>(null);
  const [totalMemories, setTotalMemories] = useState(0);
  const [avgHealth, setAvgHealth] = useState(0);

  const [input, setInput] = useState('');
  const [currentHint, setCurrentHint] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  // Init: seed persona on mount
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

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const userMsg: ChatMessage = { role: 'user', content: text.trim() };

    setLeftMessages(prev => [...prev, userMsg]);
    setRightMessages(prev => [...prev, userMsg]);
    setLeftLoading(true);
    setRightLoading(true);
    setInput('');

    const leftHistory = [...leftMessages, userMsg].map(m => ({ role: m.role, content: m.content }));
    const rightHistory = [...rightMessages, userMsg].map(m => ({ role: m.role, content: m.content }));

    // Fire both requests in parallel
    const [leftResult, rightResult] = await Promise.allSettled([
      sendChat({ messages: leftHistory, session_id: sessionId, mode: 'without_memory' }),
      sendChat({ messages: rightHistory, session_id: sessionId, mode: 'with_memory' }),
    ]);

    if (leftResult.status === 'fulfilled') {
      setLeftMessages(prev => [...prev, { role: 'assistant', content: leftResult.value.response }]);
    } else {
      setLeftMessages(prev => [...prev, { role: 'assistant', content: '❌ Error: ' + (leftResult.reason as Error).message }]);
    }
    setLeftLoading(false);

    if (rightResult.status === 'fulfilled') {
      const r = rightResult.value;
      setRightMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: r.response,
          memoriesUsed: r.memories_used,
          contradictionDetected: r.contradiction_detected,
        },
      ]);
      setMemoriesUsed(r.memories_used || []);
      setMemoriesStored(r.memories_stored || []);
      setContradiction(r.contradiction_detected || null);
    } else {
      setRightMessages(prev => [...prev, { role: 'assistant', content: '❌ Error: ' + (rightResult.reason as Error).message }]);
    }
    setRightLoading(false);

    const newTurn = turnCount + 1;
    setTurnCount(newTurn);

    // Show hints in free mode
    if (mode === 'free' && FREE_MODE_HINTS[newTurn]) {
      setCurrentHint(FREE_MODE_HINTS[newTurn]);
    }

    // Advance scenario step
    if (mode === 'guided') {
      setScenarioStep(prev => prev + 1);
    }
  }, [leftMessages, rightMessages, sessionId, turnCount, mode]);

  const handleReset = useCallback(async () => {
    await resetSession(sessionId).catch(() => {});
    setLeftMessages([]);
    setRightMessages([]);
    setMemoriesUsed([]);
    setMemoriesStored([]);
    setContradiction(null);
    setTotalMemories(0);
    setAvgHealth(0);
    setTurnCount(0);
    setScenarioStep(0);
    setCurrentHint(null);
    if (selectedPersona !== 'fresh') {
      await seedPersona(sessionId, selectedPersona).catch(() => {});
    }
  }, [sessionId, selectedPersona]);

  const handleClearChat = useCallback(() => {
    // Clear messages but keep memories (for cross-session scenarios)
    setLeftMessages([]);
    setRightMessages([]);
  }, []);

  const handleScenarioChange = useCallback((s: Scenario | null) => {
    if (s) {
      setSelectedScenario(s);
      setScenarioStep(0);
      setMode('guided');
    }
  }, []);

  const handlePersonaChange = useCallback((id: string) => {
    setSelectedPersona(id);
    setLeftMessages([]);
    setRightMessages([]);
    setMemoriesUsed([]);
    setMemoriesStored([]);
    setContradiction(null);
    setScenarioStep(0);
    setTurnCount(0);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const isLoading = leftLoading || rightLoading;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        sessionId={sessionId}
        selectedPersona={selectedPersona}
        onSelectPersona={handlePersonaChange}
        selectedScenario={selectedScenario}
        onSelectScenario={handleScenarioChange}
        mode={mode}
        onToggleMode={() => setMode(m => (m === 'free' ? 'guided' : 'free'))}
        onReset={handleReset}
      />

      {/* Main content area */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3 p-3">
        {/* Chat panels */}
        <div className="flex-1 min-h-0 flex flex-col sm:flex-row gap-3">
          <div className="flex-1 min-h-0">
            <ChatPanel
              title="Without Memory"
              subtitle="Standard AI — no persistence"
              messages={leftMessages}
              isLoading={leftLoading}
              accentColor="zinc"
            />
          </div>
          <div className="flex-1 min-h-0">
            <ChatPanel
              title="With MenteDB"
              subtitle="AI + persistent memory"
              messages={rightMessages}
              isLoading={rightLoading}
              accentColor="emerald"
            />
          </div>
        </div>

        {/* Memory feed sidebar */}
        <div className="w-full lg:w-72 xl:w-80 shrink-0 h-48 lg:h-auto">
          <MemoryFeed
            memoriesUsed={memoriesUsed}
            memoriesStored={memoriesStored}
            contradiction={contradiction}
            totalMemories={totalMemories}
            avgHealth={avgHealth}
          />
        </div>
      </div>

      {/* Bottom controls */}
      <div className="shrink-0 p-3 space-y-3 border-t border-zinc-800">
        {/* Hint / Scenario Player */}
        {mode === 'guided' && selectedScenario && (
          <ScenarioPlayer
            scenario={selectedScenario}
            currentStep={scenarioStep}
            onSendStep={sendMessage}
            onClearChat={handleClearChat}
            isLoading={isLoading}
          />
        )}

        {mode === 'free' && currentHint && (
          <HintBubble
            text={currentHint}
            visible={!!currentHint}
            onDismiss={() => setCurrentHint(null)}
          />
        )}

        {/* Input field */}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={mode === 'guided' ? "Use the scenario player above, or type your own message..." : "Type a message to both AIs..."}
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Send size={14} />
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
