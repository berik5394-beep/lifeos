import { useFocusStore } from '@/stores/focus-store';

beforeEach(() => {
  useFocusStore.setState({
    activeTaskId: null,
    activeTaskTitle: '',
    pomodoroMinutes: 25,
    breakMinutes: 5,
    secondsRemaining: 0,
    isRunning: false,
    isPaused: false,
    isBreak: false,
    sessionsCompleted: 0,
    totalFocusMinutesToday: 0,
  });
  jest.clearAllMocks();
});

describe('useFocusStore', () => {
  it('has correct initial state', () => {
    const state = useFocusStore.getState();
    expect(state.isRunning).toBe(false);
    expect(state.isPaused).toBe(false);
    expect(state.isBreak).toBe(false);
    expect(state.pomodoroMinutes).toBe(25);
    expect(state.breakMinutes).toBe(5);
    expect(state.secondsRemaining).toBe(0);
    expect(state.sessionsCompleted).toBe(0);
    expect(state.activeTaskId).toBeNull();
  });

  describe('startFocus', () => {
    it('sets isRunning to true and initializes timer', () => {
      useFocusStore.getState().startFocus('task-1', 'Write tests');

      const state = useFocusStore.getState();
      expect(state.isRunning).toBe(true);
      expect(state.isPaused).toBe(false);
      expect(state.isBreak).toBe(false);
      expect(state.activeTaskId).toBe('task-1');
      expect(state.activeTaskTitle).toBe('Write tests');
      expect(state.secondsRemaining).toBe(25 * 60); // 1500 seconds
    });
  });

  describe('pauseFocus / resumeFocus', () => {
    it('pauses a running timer', () => {
      useFocusStore.getState().startFocus('task-1', 'Test');
      useFocusStore.getState().pauseFocus();

      const state = useFocusStore.getState();
      expect(state.isRunning).toBe(false);
      expect(state.isPaused).toBe(true);
    });

    it('resumes a paused timer', () => {
      useFocusStore.getState().startFocus('task-1', 'Test');
      useFocusStore.getState().pauseFocus();
      useFocusStore.getState().resumeFocus();

      const state = useFocusStore.getState();
      expect(state.isRunning).toBe(true);
      expect(state.isPaused).toBe(false);
    });
  });

  describe('tick', () => {
    it('decreases secondsRemaining by 1', () => {
      useFocusStore.getState().startFocus('task-1', 'Test');
      const initial = useFocusStore.getState().secondsRemaining;

      useFocusStore.getState().tick();

      expect(useFocusStore.getState().secondsRemaining).toBe(initial - 1);
    });

    it('does nothing when not running', () => {
      useFocusStore.setState({ isRunning: false, secondsRemaining: 100 });

      useFocusStore.getState().tick();

      expect(useFocusStore.getState().secondsRemaining).toBe(100);
    });

    it('transitions to break when work session timer reaches 0', () => {
      useFocusStore.setState({
        isRunning: true,
        isBreak: false,
        secondsRemaining: 1,
        pomodoroMinutes: 25,
        breakMinutes: 5,
        totalFocusMinutesToday: 0,
        activeTaskId: 'task-1',
      });

      useFocusStore.getState().tick();

      const state = useFocusStore.getState();
      expect(state.isBreak).toBe(true);
      expect(state.isRunning).toBe(true);
      expect(state.secondsRemaining).toBe(5 * 60); // break duration
      expect(state.totalFocusMinutesToday).toBe(25); // work session minutes added
    });

    it('completes session when break timer reaches 0', () => {
      useFocusStore.setState({
        isRunning: true,
        isBreak: true,
        secondsRemaining: 1,
        breakMinutes: 5,
        sessionsCompleted: 0,
      });

      useFocusStore.getState().tick();

      const state = useFocusStore.getState();
      expect(state.isBreak).toBe(false);
      expect(state.isRunning).toBe(false);
      expect(state.secondsRemaining).toBe(0);
      expect(state.sessionsCompleted).toBe(1);
    });
  });

  describe('endFocus', () => {
    it('resets all timer state', () => {
      useFocusStore.getState().startFocus('task-1', 'Test');
      // Simulate some ticks
      useFocusStore.setState({ secondsRemaining: 25 * 60 - 120 }); // 2 min elapsed

      useFocusStore.getState().endFocus();

      const state = useFocusStore.getState();
      expect(state.activeTaskId).toBeNull();
      expect(state.activeTaskTitle).toBe('');
      expect(state.isRunning).toBe(false);
      expect(state.isPaused).toBe(false);
      expect(state.isBreak).toBe(false);
      expect(state.secondsRemaining).toBe(0);
      // Should have accumulated 2 minutes of focus
      expect(state.totalFocusMinutesToday).toBe(2);
    });
  });

  describe('skipBreak', () => {
    it('ends break and increments sessionsCompleted', () => {
      useFocusStore.setState({
        isBreak: true,
        isRunning: true,
        secondsRemaining: 120,
        sessionsCompleted: 1,
      });

      useFocusStore.getState().skipBreak();

      const state = useFocusStore.getState();
      expect(state.isBreak).toBe(false);
      expect(state.isRunning).toBe(false);
      expect(state.sessionsCompleted).toBe(2);
    });

    it('does nothing when not in break mode', () => {
      useFocusStore.setState({
        isBreak: false,
        isRunning: true,
        secondsRemaining: 500,
        sessionsCompleted: 0,
      });

      useFocusStore.getState().skipBreak();

      expect(useFocusStore.getState().sessionsCompleted).toBe(0);
      expect(useFocusStore.getState().isRunning).toBe(true);
    });
  });

  describe('setPomodoroMinutes', () => {
    it('clamps values between 1 and 120', () => {
      useFocusStore.getState().setPomodoroMinutes(0);
      expect(useFocusStore.getState().pomodoroMinutes).toBe(1);

      useFocusStore.getState().setPomodoroMinutes(200);
      expect(useFocusStore.getState().pomodoroMinutes).toBe(120);

      useFocusStore.getState().setPomodoroMinutes(45);
      expect(useFocusStore.getState().pomodoroMinutes).toBe(45);
    });
  });

  describe('setBreakMinutes', () => {
    it('clamps values between 1 and 30', () => {
      useFocusStore.getState().setBreakMinutes(0);
      expect(useFocusStore.getState().breakMinutes).toBe(1);

      useFocusStore.getState().setBreakMinutes(60);
      expect(useFocusStore.getState().breakMinutes).toBe(30);

      useFocusStore.getState().setBreakMinutes(10);
      expect(useFocusStore.getState().breakMinutes).toBe(10);
    });
  });
});
