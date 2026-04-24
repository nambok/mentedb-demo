export interface ScenarioStep {
  user: string;
  hint: string;
  sessionBreak?: boolean; // If true, this step triggers a "New Session" instead of sending a message
}

export interface Scenario {
  id: string;
  description: string;
  steps: ScenarioStep[];
}

// Each persona has its own scenario that tells a multi-session narrative
export const personaScenarios: Record<string, Scenario> = {
  developer: {
    id: 'developer',
    description: 'Build context about your project, then see MenteDB remember it all in a new session',
    steps: [
      {
        user: "I'm building a SaaS app called TaskPilot using Next.js and Supabase",
        hint: "🧠 MenteDB extracts project name, framework, and database — stored as semantic memories",
      },
      {
        user: "I prefer Tailwind CSS and always use TypeScript strict mode",
        hint: "📌 Preferences stored — MenteDB will use these to personalize future responses",
      },
      {
        user: "Last time I used Firebase it was a nightmare — auth kept breaking in production",
        hint: "🔴 Pain signal recorded! MenteDB will proactively warn you if Firebase comes up again",
      },
      {
        user: '',
        hint: "✨ Starting a brand new conversation — chat history is wiped. But MenteDB remembers everything.",
        sessionBreak: true,
      },
      {
        user: "Help me set up authentication for my project",
        hint: "🔮 Watch: MenteDB recalls your project (TaskPilot), stack (Next.js), and Firebase pain — without you repeating anything",
      },
      {
        user: "Actually I switched from Supabase to PlanetScale yesterday",
        hint: "⚡ Contradiction detected! MenteDB catches the Supabase → PlanetScale change and updates its understanding",
      },
      {
        user: "Based on everything you know about me, suggest a deployment strategy",
        hint: "🧩 Full context assembly: project + stack + preferences + pain signals + recent changes → tailored advice",
      },
      {
        user: "What do you know about me and my project?",
        hint: "🔗 Entity resolution: MenteDB synthesizes everything — project, tools, preferences, changes, pain points",
      },
    ],
  },

  student: {
    id: 'student',
    description: 'Share your research context, then see MenteDB guide you in a new session',
    steps: [
      {
        user: "I'm working on my thesis about transformer attention mechanisms using PyTorch",
        hint: "🧠 MenteDB stores your research topic, framework, and academic context",
      },
      {
        user: "I train my models on a university GPU cluster with SLURM",
        hint: "📌 Infrastructure preferences stored — MenteDB learns your setup",
      },
      {
        user: "Google Colab kept disconnecting during long training runs — lost 8 hours of work",
        hint: "🔴 Pain signal: Colab disconnections. MenteDB will warn you if Colab comes up again",
      },
      {
        user: '',
        hint: "✨ New session — imagine it's the next day. Chat cleared, but MenteDB remembers your research context.",
        sessionBreak: true,
      },
      {
        user: "I need to run a 24-hour training job — what platform should I use?",
        hint: "🔮 Watch: MenteDB recalls your GPU cluster setup AND warns against Colab due to your past pain",
      },
      {
        user: "Actually I switched from PyTorch to JAX for better TPU support",
        hint: "⚡ Contradiction: PyTorch → JAX! MenteDB catches the framework change",
      },
      {
        user: "Help me optimize my attention mechanism implementation",
        hint: "🧩 Context assembly: thesis topic + new framework (JAX) + infrastructure → personalized guidance",
      },
    ],
  },

  pm: {
    id: 'pm',
    description: 'Set up your product context, then watch MenteDB assist in sprint planning',
    steps: [
      {
        user: "I manage a B2B HR analytics platform targeting enterprise companies with 500+ employees",
        hint: "🧠 MenteDB stores product, market segment, and company size as semantic memories",
      },
      {
        user: "We use 2-week sprints with Jira and we're planning to add an AI-powered insights feature",
        hint: "📌 Process and roadmap stored — MenteDB learns your methodology",
      },
      {
        user: "We tried Mixpanel for analytics and the pricing model was a nightmare — way too expensive at scale",
        hint: "🔴 Pain signal: Mixpanel pricing. MenteDB will flag this if similar tools come up",
      },
      {
        user: '',
        hint: "✨ New session — next week's sprint planning. Chat history is gone, but MenteDB remembers your product context.",
        sessionBreak: true,
      },
      {
        user: "Help me prioritize features for the next sprint",
        hint: "🔮 MenteDB recalls your product, target market, methodology, and planned AI feature — without re-explaining",
      },
      {
        user: "Actually we're pivoting to target startups instead of enterprises",
        hint: "⚡ Contradiction: enterprise → startups! MenteDB detects the market shift and updates its understanding",
      },
      {
        user: "We need an analytics tool for tracking feature adoption — what do you recommend?",
        hint: "🧩 Context assembly: knows your Mixpanel pain + startup pivot → avoids expensive tools, suggests startup-friendly options",
      },
    ],
  },

  fresh: {
    id: 'fresh',
    description: 'Start from scratch — build memories from nothing and see them persist',
    steps: [
      {
        user: "I'm building a food delivery app called BiteBuddy using React Native and Firebase",
        hint: "🧠 First memory! MenteDB stores your project, stack, and backend — starting from zero",
      },
      {
        user: "I prefer dark mode UIs and minimal dependencies in my projects",
        hint: "📌 Preferences stored — MenteDB is learning about you in real-time",
      },
      {
        user: "AWS Lambda cold starts were terrible last time — 3 second delays on every request",
        hint: "🔴 Pain signal stored: Lambda cold starts. Watch what happens in the next session...",
      },
      {
        user: '',
        hint: "✨ New session — all chat history wiped. Can the AI still help you without context? MenteDB can.",
        sessionBreak: true,
      },
      {
        user: "I need to deploy my app — what hosting should I use?",
        hint: "🔮 MenteDB recalls your React Native project AND warns about Lambda cold starts — even in a new session",
      },
      {
        user: "Actually we rebranded from BiteBuddy to FeastFleet",
        hint: "⚡ Entity update: MenteDB links BiteBuddy → FeastFleet and updates the project name",
      },
      {
        user: "Summarize everything you know about me and my project",
        hint: "🔗 Full recall: project, preferences, pain points, name change — all from memory, nothing from chat history",
      },
    ],
  },
};
