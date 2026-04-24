import { Play, RotateCcw, Loader2 } from 'lucide-react';
import type { Scenario } from '../data/scenarios';

interface ScenarioPlayerProps {
  scenario: Scenario;
  currentStep: number;
  onSendStep: (message: string) => void;
  onClearChat: () => void;
  isLoading: boolean;
}

export default function ScenarioPlayer({
  scenario,
  currentStep,
  onSendStep,
  onClearChat,
  isLoading,
}: ScenarioPlayerProps) {
  const totalSteps = scenario.steps.length;
  const isComplete = currentStep >= totalSteps;
  const step = isComplete ? null : scenario.steps[currentStep];
  const progress = (currentStep / totalSteps) * 100;

  const needsClearChat =
    (scenario.id === 'cross-session' || scenario.id === 'meeting') &&
    currentStep === 3;

  const Icon = scenario.icon;

  return (
    <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={18} className="text-emerald-400 shrink-0" />
          <div>
            <span className="text-sm font-medium text-zinc-200">{scenario.title}</span>
            <span className="ml-2 text-xs text-zinc-500">— {scenario.feature}</span>
          </div>
        </div>
        <span className="text-xs text-zinc-500">
          Step {Math.min(currentStep + 1, totalSteps)} of {totalSteps}
        </span>
      </div>

      <div className="w-full h-1.5 bg-zinc-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {step?.hint && (
        <div className="text-xs bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2 text-emerald-300">
          💡 {step.hint}
        </div>
      )}

      <div className="flex items-center gap-2">
        {isComplete ? (
          <div className="text-sm text-emerald-400">
            ✅ Scenario complete! Try another or switch to Free Chat.
          </div>
        ) : needsClearChat ? (
          <button
            onClick={onClearChat}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm hover:bg-amber-500/20 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            <RotateCcw size={14} />
            Clear Chat History (keep memories)
          </button>
        ) : (
          <button
            onClick={() => step && onSendStep(step.user)}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm hover:bg-emerald-500/20 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Send: "{step?.user.slice(0, 50)}{(step?.user.length ?? 0) > 50 ? '...' : ''}"
          </button>
        )}
      </div>
    </div>
  );
}
