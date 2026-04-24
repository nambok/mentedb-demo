import { useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
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

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-750 transition-colors"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <span>{current.emoji}</span>}
        <span className="hidden sm:inline">{current.label}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 left-0 z-20 w-64 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl overflow-hidden">
            {personas.map(p => (
              <button
                key={p.id}
                onClick={() => handleSelect(p)}
                className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-zinc-700/50 transition-colors ${
                  p.id === selected ? 'bg-zinc-700/30' : ''
                }`}
              >
                <span className="text-lg">{p.emoji}</span>
                <div>
                  <div className="text-sm text-zinc-200">{p.label}</div>
                  <div className="text-xs text-zinc-500">{p.description}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {toast && (
        <div className="absolute top-full mt-2 left-0 z-30 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-1.5 text-xs text-emerald-400 whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}
