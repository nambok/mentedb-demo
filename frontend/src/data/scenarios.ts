import type { LucideIcon } from 'lucide-react';
import { Zap, ShieldAlert, RefreshCw, Puzzle, Link2, ClipboardList } from 'lucide-react';

export interface ScenarioStep {
  user: string;
  hint?: string;
}

export interface Scenario {
  id: string;
  title: string;
  icon: LucideIcon;
  description: string;
  feature: string;
  steps: ScenarioStep[];
}

export const scenarios: Scenario[] = [
  {
    id: 'contradiction',
    title: 'The Contradiction Catcher',
    icon: Zap,
    description: 'Watch MenteDB detect when you change your mind',
    feature: 'Contradiction Detection',
    steps: [
      { user: "I'm using PostgreSQL for my database", hint: "Both AIs respond similarly — no difference yet" },
      { user: "Actually I switched to MongoDB last week", hint: "⚡ MenteDB detects the contradiction: PostgreSQL → MongoDB" },
      { user: "What database am I using?", hint: "Without memory: no idea. With MenteDB: knows you switched to MongoDB" },
    ],
  },
  {
    id: 'pain',
    title: 'The Pain Learner',
    icon: ShieldAlert,
    description: 'MenteDB remembers bad experiences and avoids them',
    feature: 'Pain Signals',
    steps: [
      { user: "Last time I used Redis for session storage it was terrible — constant connection drops and data loss", hint: "MenteDB records this as a pain signal 🔴" },
      { user: "What should I use for session management in my Express app?", hint: "Without memory: might recommend Redis! With MenteDB: avoids Redis, suggests alternatives" },
      { user: "What about caching? Any recommendations?", hint: "MenteDB remembers the Redis pain even in different contexts" },
    ],
  },
  {
    id: 'cross-session',
    title: 'Cross-Session Memory',
    icon: RefreshCw,
    description: 'The killer feature — memory survives conversation resets',
    feature: 'Persistent Memory',
    steps: [
      { user: "I'm building a marketplace called ShopFlow", hint: "MenteDB stores this as a project memory" },
      { user: "It uses Next.js, Stripe, and Prisma with PostgreSQL", hint: "Building up project context..." },
      { user: "My deadline is end of Q2", hint: "Three facts stored. Now click 'Clear Chat History' ↓" },
      { user: "What am I working on?", hint: "🔄 Chat was cleared but MenteDB still remembers everything!" },
    ],
  },
  {
    id: 'context',
    title: 'The Context Assembler',
    icon: Puzzle,
    description: 'Scattered preferences become personalized recommendations',
    feature: 'Context Assembly',
    steps: [
      { user: "I prefer functional programming patterns", hint: "Preference #1 stored" },
      { user: "I always use ESLint with strict rules", hint: "Preference #2 stored" },
      { user: "I hate ORMs — I write raw SQL", hint: "Preference #3 + pain signal stored" },
      { user: "Set up a new TypeScript project based on everything you know about me", hint: "🧩 MenteDB assembles all preferences into a tailored setup" },
    ],
  },
  {
    id: 'entity',
    title: 'The Entity Resolver',
    icon: Link2,
    description: 'MenteDB connects the dots between different mentions',
    feature: 'Entity Resolution',
    steps: [
      { user: "I'm working with React on the frontend of my app", hint: "MenteDB registers 'React' as an entity" },
      { user: "The UI framework we picked has great component composition", hint: "🔗 MenteDB resolves 'UI framework' = React" },
      { user: "How should I structure my components for the project?", hint: "MenteDB knows exactly which framework and project you mean" },
    ],
  },
  {
    id: 'meeting',
    title: 'The Meeting Recap',
    icon: ClipboardList,
    description: 'Extract and recall structured facts across sessions',
    feature: 'Fact Extraction',
    steps: [
      { user: "In today's standup: the auth service is blocked on the OAuth provider. Sarah is handling payment integration. We pushed launch from March to April. CEO wants a demo by Friday.", hint: "MenteDB extracts 4 distinct facts from this message" },
      { user: "What are the current blockers?", hint: "Both know (it's in chat history). But watch what happens next..." },
      { user: "Summarize what we discussed in the last standup", hint: "📋 Without memory: blank. With MenteDB: full structured recall" },
    ],
  },
];
