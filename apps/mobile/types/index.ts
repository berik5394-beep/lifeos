export interface User {
  id: string;
  email: string;
  name: string;
  currency: string;
  assistantStyle: AssistantStyle;
  settings: Record<string, unknown>;
  createdAt: string;
}

export interface Habit {
  id: string;
  userId: string;
  name: string;
  category: string;
  frequency: string;
  goalId: string | null;
  autoComplete: Record<string, unknown> | null;
  order: number;
  active: boolean;
  createdAt: string;
}

export interface HabitLog {
  id: string;
  habitId: string;
  userId: string;
  date: string;
  completed: boolean;
  autoCompleted: boolean;
}

export interface Task {
  id: string;
  userId: string;
  title: string;
  category: string;
  priority: string;
  date: string;
  time: string | null;
  completed: boolean;
  notes: string | null;
  createdAt: string;
}

export interface WeeklyGoal {
  id: string;
  userId: string;
  weekStart: string;
  goalText: string;
  completed: boolean;
  order: number;
}

export interface YearlyGoal {
  id: string;
  userId: string;
  year: number;
  area: string;
  goalText: string;
  progress: number;
}

export interface Expense {
  id: string;
  userId: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  createdAt: string;
}

export interface Income {
  id: string;
  userId: string;
  date: string;
  source: string;
  amount: number;
  createdAt: string;
}

export interface JournalEntry {
  id: string;
  userId: string;
  date: string;
  sleepHours: number | null;
  energy: number | null;
  mood: number | null;
  notes: string | null;
}

export interface StepLog {
  id: string;
  userId: string;
  date: string;
  steps: number;
  distanceKm: number | null;
  gpsTrack: Record<string, unknown> | null;
}

export interface CalendarEvent {
  id: string;
  userId: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  description: string | null;
  reminder: number;
  source: string;
  createdAt: string;
}

export interface ImportedFile {
  id: string;
  userId: string;
  fileName: string;
  fileType: string;
  purpose: string;
  parsedData: unknown;
  createdAt: string;
}

export interface BudgetLimit {
  id: string;
  userId: string;
  category: string;
  monthlyLimit: number;
  month: number;
  year: number;
}

export type TaskCategory = 'work' | 'personal' | 'health' | 'finance' | 'education' | 'home';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type HabitCategory = 'health' | 'work' | 'personal';
export type GoalArea = 'finance' | 'spirituality' | 'career' | 'health';
export type AssistantStyle = 'friendly' | 'strict' | 'calm' | 'toxic';
export type ExpenseCategory = 'food' | 'transport' | 'entertainment' | 'clothing' | 'health' | 'home' | 'other';
