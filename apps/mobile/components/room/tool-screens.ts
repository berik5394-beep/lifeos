import type { ComponentType } from 'react';
import type { ToolKey } from '@/services/room-tools';
import DashboardScreen from '@/screens/dashboard';
import TasksScreen from '@/screens/tasks';
import DealsScreen from '@/screens/deals';
import HabitsScreen from '@/screens/habits';
import GoalsScreen from '@/screens/goals';
import FinanceScreen from '@/screens/finance';
import CalendarScreen from '@/screens/calendar';
import JournalScreen from '@/screens/journal';

/** Экран каждого инструмента — существующие экраны, без перерисовки. */
export const TOOL_SCREEN: Record<ToolKey, ComponentType> = {
  today: DashboardScreen,
  tasks: TasksScreen,
  deals: DealsScreen,
  habits: HabitsScreen,
  goals: GoalsScreen,
  finance: FinanceScreen,
  calendar: CalendarScreen,
  journal: JournalScreen,
};

export const TOOL_TITLE: Record<ToolKey, string> = {
  today: 'Сегодня',
  tasks: 'Задачи',
  deals: 'Сделки',
  habits: 'Привычки',
  goals: 'Цели',
  finance: 'Финансы',
  calendar: 'Календарь',
  journal: 'Дневник',
};
