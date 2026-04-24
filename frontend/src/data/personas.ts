import type { LucideIcon } from 'lucide-react';
import { Code2, GraduationCap, BarChart3, Sparkles } from 'lucide-react';

export interface Persona {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

export const personas: Persona[] = [
  { id: 'developer', label: 'Software Developer', icon: Code2, description: 'MongoDB, TypeScript, AWS, VS Code' },
  { id: 'student', label: 'CS Student', icon: GraduationCap, description: 'Python, ML, PyTorch, Jupyter' },
  { id: 'pm', label: 'Product Manager', icon: BarChart3, description: 'Agile, React, PostgreSQL, Figma' },
  { id: 'fresh', label: 'Start Fresh', icon: Sparkles, description: 'No pre-loaded memories' },
];
