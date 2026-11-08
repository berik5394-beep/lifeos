import { useChatStore } from '@/stores/chat-store';
import { useRobotReactionStore } from '@/stores/robot-reaction-store';
import type { RescheduleProposal } from '@/stores/schedule-store';

/**
 * Предупреждения сервера после создания задачи/встречи С ЭКРАНА — в одно облачко.
 * Перегруз дня (proposal, с кнопкой «Подтвердить») показывается сообщением
 * робота и перекрывал облачко наложения: при обоих сразу наложение терялось.
 * Теперь наложение — первой строкой того же облачка.
 */
export function surfaceCreateWarnings(proposal?: RescheduleProposal, conflictWarning?: string): void {
  if (proposal) {
    useChatStore
      .getState()
      .showProposal(conflictWarning ? { ...proposal, text: `${conflictWarning}\n${proposal.text}` } : proposal);
    return;
  }
  if (conflictWarning) useRobotReactionStore.getState().react('worried', conflictWarning);
}
