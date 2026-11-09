-- Аудит 2026-11-09: связь записей с импортом файла (дубли при повторе, удаление импорта).
ALTER TABLE "Expense" ADD COLUMN "importId" TEXT;
ALTER TABLE "Task" ADD COLUMN "importId" TEXT;
ALTER TABLE "CalendarEvent" ADD COLUMN "importId" TEXT;
ALTER TABLE "Habit" ADD COLUMN "importId" TEXT;
CREATE INDEX "Expense_importId_idx" ON "Expense"("importId");
CREATE INDEX "Task_importId_idx" ON "Task"("importId");
CREATE INDEX "CalendarEvent_importId_idx" ON "CalendarEvent"("importId");
CREATE INDEX "Habit_importId_idx" ON "Habit"("importId");
