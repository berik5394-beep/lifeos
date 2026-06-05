-- Task.cancelled: мягкая отмена задачи (обратимо, не hard-delete). Additive,
-- nullable-default, идемпотентно. Чинит «убери задачу» (cancel_task) +
-- get_tasks/брифинг исключают отменённые.
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "cancelled" BOOLEAN NOT NULL DEFAULT false;
