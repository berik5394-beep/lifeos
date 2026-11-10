export type RootStackParamList = {
  Onboarding: undefined;
  /** Согласие (16+, условия, сторонний ИИ) — пока не дано, вместо приложения. */
  Consent: undefined;
  Auth: undefined;
  Home: undefined;
  Dashboard: undefined;
  Tasks: undefined;
  Habits: undefined;
  Goals: undefined;
  Finance: undefined;
  Activity: undefined;
  Journal: undefined;
  Deals: undefined;
  Settings: undefined;
  Integrations: undefined;
  Import: undefined;
  ScheduleImport: undefined;
  TaskCapture: undefined;
  ReceiptScan: undefined;
  VoiceConversation: undefined;
  FocusMode: { taskId: string; taskTitle: string };
  KanbanBoard: undefined;
  Calendar: undefined;
  ChatHistory: undefined;
  GanttView: undefined;
  SharedSpaces: undefined;
  SharedSpaceDetail: { spaceId: string; spaceName: string };
  TagManager: undefined;
  Export: undefined;
  LifeInsights: undefined;
  Legal: undefined;
  RobotMemory: undefined;
  RobotDiary: undefined;
  RobotHelp: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: { email?: string } | undefined;
  /** Политика и условия — до входа тоже (ссылка у галочки согласия). */
  Legal: undefined;
};

