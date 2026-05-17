-- CreateTable
CREATE TABLE "PendingAction" (
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "inputJson" JSONB NOT NULL,
    "confirmationText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingAction_pkey" PRIMARY KEY ("userId")
);

