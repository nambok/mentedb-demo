export interface Persona {
  id: string;
  label: string;
  emoji: string;
  description: string;
}

export const personas: Persona[] = [
  { id: 'developer', label: 'Software Developer', emoji: '💻', description: 'MongoDB, TypeScript, AWS, VS Code' },
  { id: 'student', label: 'CS Student', emoji: '🎓', description: 'Python, ML, PyTorch, Jupyter' },
  { id: 'pm', label: 'Product Manager', emoji: '📊', description: 'Agile, React, PostgreSQL, Figma' },
  { id: 'fresh', label: 'Start Fresh', emoji: '✨', description: 'No pre-loaded memories' },
];
