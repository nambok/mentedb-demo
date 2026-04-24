import { RotateCcw, ExternalLink } from 'lucide-react';
import PersonaSelector from './PersonaSelector';
import { scenarios, type Scenario } from '../data/scenarios';

interface HeaderProps {
  sessionId: string;
  selectedPersona: string;
  onSelectPersona: (id: string) => void;
  selectedScenario: Scenario | null;
  onSelectScenario: (s: Scenario | null) => void;
  mode: 'free' | 'guided';
  onToggleMode: () => void;
  onReset: () => void;
}

export default function Header({
  sessionId,
  selectedPersona,
  onSelectPersona,
  selectedScenario,
  onSelectScenario,
  mode,
  onToggleMode,
  onReset,
}: HeaderProps) {
  return (
    <header className="bg-zinc-900 border-b border-zinc-800 px-4 py-2.5 flex items-center justify-between gap-3 shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold bg-gradient-to-r from-emerald-400 to-emerald-300 bg-clip-text text-transparent whitespace-nowrap">
          MenteDB Demo
        </h1>

        <PersonaSelector
          sessionId={sessionId}
          selected={selectedPersona}
          onSelect={onSelectPersona}
        />

        <div className="hidden md:block relative">
          <select
            value={selectedScenario?.id ?? ''}
            onChange={e => {
              const s = scenarios.find(sc => sc.id === e.target.value) ?? null;
              onSelectScenario(s);
            }}
            className="appearance-none px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-300 pr-8 cursor-pointer"
          >
            {scenarios.map(s => (
              <option key={s.id} value={s.id}>
                {s.emoji} {s.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onToggleMode}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            mode === 'guided'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
              : 'bg-zinc-800 border border-zinc-700 text-zinc-400'
          }`}
        >
          {mode === 'guided' ? '🎯 Guided' : '💬 Free Chat'}
        </button>

        <button
          onClick={onReset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <RotateCcw size={13} />
          <span className="hidden sm:inline">Reset</span>
        </button>

        <a
          href="https://mentedb.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <ExternalLink size={13} />
          <span className="hidden sm:inline">mentedb.com</span>
        </a>
      </div>
    </header>
  );
}
