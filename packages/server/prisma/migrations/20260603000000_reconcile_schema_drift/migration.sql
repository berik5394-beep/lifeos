-- Baseline-reconcile (ИДЕМПОТЕНТНАЯ): примиряет migrations-историю со schema.prisma.
-- Прод исторически жил на db push → ~19 таблиц/24 FK/34 индекса/десятки колонок есть
-- в БД, но не в migrations/. Эта миграция БЕЗОПАСНА в обе стороны:
--   • чистая БД → migrate deploy ВЫПОЛНЯЕТ её и достраивает полную схему;
--   • существующая (прод) → каждый стейтмент no-op (IF NOT EXISTS / DROP-then-ADD FK).
-- Поэтому НЕ нужен ручной migrate resolve — deploy безопасен везде. Источник: prisma
-- migrate diff (from-migrations → schema), переписан в идемпотентную форму.

-- DropForeignKey
ALTER TABLE "SkillDefinition" DROP CONSTRAINT IF EXISTS "SkillDefinition_userId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "Memory_entityRefs_gin_idx";

-- DropIndex
DROP INDEX IF EXISTS "MoodSnapshot_entityRefs_gin_idx";

-- AlterTable
ALTER TABLE "BotIdentity" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN IF NOT EXISTS     "externalId" TEXT;

-- AlterTable
ALTER TABLE "Entity" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "EntityRelationship" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MoodSnapshot" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Pattern" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Pet" ADD COLUMN IF NOT EXISTS     "characterType" TEXT NOT NULL DEFAULT 'warrior',
ADD COLUMN IF NOT EXISTS     "equippedArmor" TEXT,
ADD COLUMN IF NOT EXISTS     "equippedAura" TEXT,
ADD COLUMN IF NOT EXISTS     "equippedBoots" TEXT,
ADD COLUMN IF NOT EXISTS     "equippedHelmet" TEXT,
ADD COLUMN IF NOT EXISTS     "equippedShield" TEXT,
ADD COLUMN IF NOT EXISTS     "equippedWeapon" TEXT,
ADD COLUMN IF NOT EXISTS     "mana" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS     "maxMana" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "SkillDefinition" ALTER COLUMN "triggers" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS     "aiScore" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS     "estimatedMinutes" INTEGER,
ADD COLUMN IF NOT EXISTS     "importance" INTEGER,
ADD COLUMN IF NOT EXISTS     "kanbanStatus" TEXT NOT NULL DEFAULT 'todo',
ADD COLUMN IF NOT EXISTS     "parentId" TEXT,
ADD COLUMN IF NOT EXISTS     "recurrence" TEXT,
ADD COLUMN IF NOT EXISTS     "sharedSpaceId" TEXT,
ADD COLUMN IF NOT EXISTS     "urgency" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS     "expoPushToken" TEXT,
ADD COLUMN IF NOT EXISTS     "subscriptionExpiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS     "subscriptionTier" TEXT NOT NULL DEFAULT 'free',
ADD COLUMN IF NOT EXISTS     "timezone" TEXT NOT NULL DEFAULT 'Asia/Almaty',
ADD COLUMN IF NOT EXISTS     "uiComplexity" TEXT NOT NULL DEFAULT 'standard';

-- AlterTable
ALTER TABLE "UserProfile" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "SentNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL DEFAULT 'push',

    CONSTRAINT "SentNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "replacedBy" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "UserInterest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "lastMentioned" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PetItem" (
    "id" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "rarity" TEXT NOT NULL DEFAULT 'common',
    "bonus" TEXT,
    "bonusValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ArenaProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trophies" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "winStreak" INTEGER NOT NULL DEFAULT 0,
    "bestWinStreak" INTEGER NOT NULL DEFAULT 0,
    "rank" TEXT NOT NULL DEFAULT 'bronze',
    "powerScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastBattleAt" TIMESTAMP(3),
    "seasonWins" INTEGER NOT NULL DEFAULT 0,
    "seasonLosses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArenaProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Battle" (
    "id" TEXT NOT NULL,
    "attackerId" TEXT NOT NULL,
    "defenderId" TEXT NOT NULL,
    "winnerId" TEXT,
    "attackerPower" DOUBLE PRECISION NOT NULL,
    "defenderPower" DOUBLE PRECISION NOT NULL,
    "attackerRoll" DOUBLE PRECISION NOT NULL,
    "defenderRoll" DOUBLE PRECISION NOT NULL,
    "attackerChar" TEXT NOT NULL,
    "defenderChar" TEXT NOT NULL,
    "attackerLevel" INTEGER NOT NULL,
    "defenderLevel" INTEGER NOT NULL,
    "trophyChange" INTEGER NOT NULL DEFAULT 0,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "battleType" TEXT NOT NULL DEFAULT 'power',
    "challengeId" TEXT,
    "log" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Battle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Challenge" (
    "id" TEXT NOT NULL,
    "battleId" TEXT,
    "attackerId" TEXT NOT NULL,
    "defenderId" TEXT NOT NULL,
    "exercise" TEXT NOT NULL,
    "exerciseName" TEXT NOT NULL,
    "targetReps" INTEGER NOT NULL,
    "attackerTarget" INTEGER NOT NULL,
    "defenderTarget" INTEGER NOT NULL,
    "manaCost" INTEGER NOT NULL DEFAULT 20,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attackerStartedAt" TIMESTAMP(3),
    "defenderStartedAt" TIMESTAMP(3),
    "attackerDone" BOOLEAN NOT NULL DEFAULT false,
    "defenderDone" BOOLEAN NOT NULL DEFAULT false,
    "attackerTime" INTEGER,
    "defenderTime" INTEGER,
    "attackerVerified" BOOLEAN NOT NULL DEFAULT false,
    "defenderVerified" BOOLEAN NOT NULL DEFAULT false,
    "winnerId" TEXT,
    "xpReward" INTEGER NOT NULL DEFAULT 30,
    "trophyReward" INTEGER NOT NULL DEFAULT 20,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ConversationSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contextSnapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ConversationMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "actions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TravelPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "dateFrom" DATE NOT NULL,
    "dateTo" DATE,
    "purpose" TEXT,
    "budget" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT '₸',
    "status" TEXT NOT NULL DEFAULT 'planning',
    "flights" JSONB,
    "hotels" JSONB,
    "routes" JSONB,
    "packingList" JSONB,
    "documents" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ContactCache" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phoneId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "birthday" DATE,
    "lastSynced" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DocumentVault" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "imageUri" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TaskDependency" (
    "id" TEXT NOT NULL,
    "dependentTaskId" TEXT NOT NULL,
    "prerequisiteTaskId" TEXT NOT NULL,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Tag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TaskTag" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "TaskTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SharedSpace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedSpace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SharedSpaceMember" (
    "id" TEXT NOT NULL,
    "sharedSpaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedSpaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DictationSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "summary" TEXT,
    "spokenResponse" TEXT,
    "tasksCreated" INTEGER NOT NULL DEFAULT 0,
    "memoriesCreated" INTEGER NOT NULL DEFAULT 0,
    "durationSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DictationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "InsightDismissal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dismissKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsightDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SentNotification_userId_sentAt_idx" ON "SentNotification"("userId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SentNotification_userId_type_scheduledFor_key" ON "SentNotification"("userId", "type", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserInterest_userId_idx" ON "UserInterest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "UserInterest_userId_topic_key" ON "UserInterest"("userId", "topic");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PetItem_petId_idx" ON "PetItem"("petId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PetItem_petId_itemKey_key" ON "PetItem"("petId", "itemKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ArenaProfile_userId_key" ON "ArenaProfile"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Battle_attackerId_idx" ON "Battle"("attackerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Battle_defenderId_idx" ON "Battle"("defenderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Battle_createdAt_idx" ON "Battle"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Challenge_attackerId_idx" ON "Challenge"("attackerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Challenge_defenderId_idx" ON "Challenge"("defenderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Challenge_status_idx" ON "Challenge"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ConversationSession_userId_idx" ON "ConversationSession"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ConversationMessage_sessionId_idx" ON "ConversationMessage"("sessionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TravelPlan_userId_idx" ON "TravelPlan"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ContactCache_userId_name_idx" ON "ContactCache"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ContactCache_userId_phoneId_key" ON "ContactCache"("userId", "phoneId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentVault_userId_idx" ON "DocumentVault"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TaskDependency_dependentTaskId_prerequisiteTaskId_key" ON "TaskDependency"("dependentTaskId", "prerequisiteTaskId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Tag_userId_idx" ON "Tag"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Tag_userId_name_key" ON "Tag"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TaskTag_taskId_tagId_key" ON "TaskTag"("taskId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SharedSpaceMember_sharedSpaceId_userId_key" ON "SharedSpaceMember"("sharedSpaceId", "userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DictationSession_userId_createdAt_idx" ON "DictationSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InsightDismissal_userId_dismissKey_idx" ON "InsightDismissal"("userId", "dismissKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InsightDismissal_userId_createdAt_idx" ON "InsightDismissal"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CalendarEvent_userId_externalId_idx" ON "CalendarEvent"("userId", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_userId_kanbanStatus_idx" ON "Task"("userId", "kanbanStatus");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_parentId_idx" ON "Task"("parentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_sharedSpaceId_idx" ON "Task"("sharedSpaceId");

-- AddForeignKey
ALTER TABLE "SentNotification" DROP CONSTRAINT IF EXISTS "SentNotification_userId_fkey";
ALTER TABLE "SentNotification" ADD CONSTRAINT "SentNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" DROP CONSTRAINT IF EXISTS "RefreshToken_userId_fkey";
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInterest" DROP CONSTRAINT IF EXISTS "UserInterest_userId_fkey";
ALTER TABLE "UserInterest" ADD CONSTRAINT "UserInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_parentId_fkey";
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_sharedSpaceId_fkey";
ALTER TABLE "Task" ADD CONSTRAINT "Task_sharedSpaceId_fkey" FOREIGN KEY ("sharedSpaceId") REFERENCES "SharedSpace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PetItem" DROP CONSTRAINT IF EXISTS "PetItem_petId_fkey";
ALTER TABLE "PetItem" ADD CONSTRAINT "PetItem_petId_fkey" FOREIGN KEY ("petId") REFERENCES "Pet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArenaProfile" DROP CONSTRAINT IF EXISTS "ArenaProfile_userId_fkey";
ALTER TABLE "ArenaProfile" ADD CONSTRAINT "ArenaProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Battle" DROP CONSTRAINT IF EXISTS "Battle_attackerId_fkey";
ALTER TABLE "Battle" ADD CONSTRAINT "Battle_attackerId_fkey" FOREIGN KEY ("attackerId") REFERENCES "ArenaProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Battle" DROP CONSTRAINT IF EXISTS "Battle_defenderId_fkey";
ALTER TABLE "Battle" ADD CONSTRAINT "Battle_defenderId_fkey" FOREIGN KEY ("defenderId") REFERENCES "ArenaProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSession" DROP CONSTRAINT IF EXISTS "ConversationSession_userId_fkey";
ALTER TABLE "ConversationSession" ADD CONSTRAINT "ConversationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" DROP CONSTRAINT IF EXISTS "ConversationMessage_sessionId_fkey";
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ConversationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelPlan" DROP CONSTRAINT IF EXISTS "TravelPlan_userId_fkey";
ALTER TABLE "TravelPlan" ADD CONSTRAINT "TravelPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactCache" DROP CONSTRAINT IF EXISTS "ContactCache_userId_fkey";
ALTER TABLE "ContactCache" ADD CONSTRAINT "ContactCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVault" DROP CONSTRAINT IF EXISTS "DocumentVault_userId_fkey";
ALTER TABLE "DocumentVault" ADD CONSTRAINT "DocumentVault_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" DROP CONSTRAINT IF EXISTS "TaskDependency_dependentTaskId_fkey";
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependentTaskId_fkey" FOREIGN KEY ("dependentTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" DROP CONSTRAINT IF EXISTS "TaskDependency_prerequisiteTaskId_fkey";
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_prerequisiteTaskId_fkey" FOREIGN KEY ("prerequisiteTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" DROP CONSTRAINT IF EXISTS "Tag_userId_fkey";
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTag" DROP CONSTRAINT IF EXISTS "TaskTag_taskId_fkey";
ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTag" DROP CONSTRAINT IF EXISTS "TaskTag_tagId_fkey";
ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSpace" DROP CONSTRAINT IF EXISTS "SharedSpace_ownerId_fkey";
ALTER TABLE "SharedSpace" ADD CONSTRAINT "SharedSpace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSpaceMember" DROP CONSTRAINT IF EXISTS "SharedSpaceMember_sharedSpaceId_fkey";
ALTER TABLE "SharedSpaceMember" ADD CONSTRAINT "SharedSpaceMember_sharedSpaceId_fkey" FOREIGN KEY ("sharedSpaceId") REFERENCES "SharedSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSpaceMember" DROP CONSTRAINT IF EXISTS "SharedSpaceMember_userId_fkey";
ALTER TABLE "SharedSpaceMember" ADD CONSTRAINT "SharedSpaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DictationSession" DROP CONSTRAINT IF EXISTS "DictationSession_userId_fkey";
ALTER TABLE "DictationSession" ADD CONSTRAINT "DictationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillDefinition" DROP CONSTRAINT IF EXISTS "SkillDefinition_userId_fkey";
ALTER TABLE "SkillDefinition" ADD CONSTRAINT "SkillDefinition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

