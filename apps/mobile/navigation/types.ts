export type RootStackParamList = {
  Onboarding: undefined;
  Auth: undefined;
  Tabs: undefined;
  Activity: undefined;
  Journal: undefined;
  Settings: undefined;
  Integrations: undefined;
  Import: undefined;
  Pet: undefined;
  Achievements: undefined;
  'character-select': undefined;
  Arena: undefined;
  Nutrition: undefined;
  ScheduleImport: undefined;
  TaskCapture: undefined;
  VoiceConversation: undefined;
  BattleScreen: {
    opponentUserId: string;
    opponentName: string;
    opponentChar: string;
    opponentLevel: number;
    opponentPower: number;
    myChar: string;
    myLevel: number;
    myPower: number;
    myName: string;
  };
  ExerciseTracker: {
    challengeId: string;
    exercise: string;
    exerciseName: string;
    targetReps: number;
    unit: string;
    opponentName: string;
    opponentTarget: number;
  };
  FocusMode: { taskId: string; taskTitle: string };
  KanbanBoard: undefined;
  GanttView: undefined;
  SharedSpaces: undefined;
  SharedSpaceDetail: { spaceId: string; spaceName: string };
  TagManager: undefined;
  Subscription: undefined;
  Export: undefined;
  LifeInsights: undefined;
  SwipeHome: undefined;
  Legal: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type TabParamList = {
  Chat: undefined;
  Dashboard: undefined;
  Tasks: undefined;
  Habits: undefined;
  Goals: undefined;
  Finance: undefined;
};
