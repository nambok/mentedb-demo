import { useState } from 'react';
import { ChevronDown, Loader2, Check } from 'lucide-react';
import { personas, type Persona } from '../data/personas';
import { seedPersona, resetSession } from '../lib/api';

interface PersonaSelectorProps {
  sessionId: string;
  selected: string;
  onSelect: (id: string) => void;
}

export default function PersonaSelector({ sessionId, selected, onSelect }: PersonaSelectorProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const current = personas.find(p => p.id === selected) as Persona;

  async function handleSelect(persona: Persona) {
    setOpen(false);
    setLoading(true);
    try {
      await resetSession(sessionId);
      if (persona.id !== 'fresh') {
        await seedPersona(sessionId, persona.id);
      }
      onSelect(persona.id);
      setToast(`Loaded ${persona.label} memories`);
      setTimeout(() => setToast(null), 2500);
    } catch {
      setToast('Failed to load persona');
      setTimeout(() => setToast(null), 2500);
    } finally {
      setLoading(false);
    }
  }

  const CurrentIcon = current.icon;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-750 transition-colors cursor-pointer"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <CurrentIcon size={14} className="text-emerald-400" />}
        <span className="hidden sm:inline">{current.label}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 left-0 z-20 w-64 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl overflow-hidden">
            {personas.map(p => {
              const Icon = p.icon;
              return (
                <button
                  key={p.id}
                  onClick={() => handleSelect(p)}
                  className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-zinc-700/50 transition-colors cursor-pointer ${
                    p.id === selected ? 'bg-zinc-700/30' : ''
                  }`}
                >
                  <Icon size={18} className={`mt-0.5 shrink-0 ${p.id === selected ? 'text-emerald-400' : 'text-zinc-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-200">{p.label}</div>
                    <div className="text-xs text-zinc-500">{p.description}</div>
                  </div>
                  {p.id === selected && <Check size={14} className="mt-0.5 text-emerald-400 shrink-0" />}
                </button>
              );
            })}
          </div>
        </>
      )}

      {toast && (
        <div className="absolute top-full mt-2 left-0 z-30 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap shadow-lg bg-zinc-900 border border-zinc-700 text-zinc-200">
          <span className="text-emerald-400 mr-1">✓</span> {toast}
        </div>
      )}
    </div>
  );
}
