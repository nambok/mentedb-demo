import { RotateCcw, ExternalLink, Target, MessageSquare } from 'lucide-react';

function GithubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}
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
                {s.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onToggleMode}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            mode === 'guided'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
              : 'bg-zinc-800 border border-zinc-700 text-zinc-400'
          }`}
        >
          {mode === 'guided' ? <Target size={13} /> : <MessageSquare size={13} />}
          {mode === 'guided' ? 'Guided' : 'Free Chat'}
        </button>

        <button
          onClick={onReset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
        >
          <RotateCcw size={13} />
          <span className="hidden sm:inline">Reset</span>
        </button>

        <a
          href="https://github.com/nambok/mentedb-demo"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
        >
          <GithubIcon size={14} />
          <span className="hidden sm:inline">Source</span>
        </a>

        <a
          href="https://mentedb.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
        >
          <ExternalLink size={13} />
          <span className="hidden sm:inline">mentedb.com</span>
        </a>
      </div>
    </header>
  );
}
