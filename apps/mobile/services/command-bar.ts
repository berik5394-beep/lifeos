/**
 * Экраны, где строки «Скажи роботу» НЕ добавляем: у дома она своя (под
 * обоими экранами), у истории чата и разговора — свой ввод, у входа и
 * знакомства — ещё нет аккаунта. Остальные экраны стека — со строкой.
 */
const NO_BAR = new Set(['Home', 'ChatHistory', 'VoiceConversation', 'Onboarding', 'Auth', 'Login', 'Register']);

export function routeHasCommandBar(routeName: string): boolean {
  return !NO_BAR.has(routeName);
}
