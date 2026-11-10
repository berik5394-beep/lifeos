-- App Store: согласие (условия/политика/сторонний ИИ) + возраст 16+, согласие на токсичный стиль.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "consentAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "consentVersion" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "toxicConsentAt" TIMESTAMP(3);
-- Кто уже выбрал токсичный стиль — проходил предупреждение в приложении.
UPDATE "User" SET "toxicConsentAt" = NOW() WHERE "assistantStyle" = 'toxic' AND "toxicConsentAt" IS NULL;
