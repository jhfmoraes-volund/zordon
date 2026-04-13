-- CreateTable
CREATE TABLE "DesignSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'inception',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "totalSteps" INTEGER NOT NULL DEFAULT 7,
    "scheduledAt" DATETIME,
    "completedAt" DATETIME,
    "actualDurationMin" INTEGER,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DesignSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DesignSession_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Member" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DesignSessionParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "memberId" TEXT,
    "externalName" TEXT,
    "externalEmail" TEXT,
    "externalRole" TEXT,
    "role" TEXT NOT NULL DEFAULT 'observer',
    CONSTRAINT "DesignSessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DesignSessionParticipant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DesignSessionStakeholder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "contact" TEXT,
    CONSTRAINT "DesignSessionStakeholder_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DesignSessionStepData" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "stepKey" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DesignSessionStepData_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DesignSessionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'feature',
    "priority" TEXT NOT NULL DEFAULT 'should',
    "sourceStep" TEXT,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "DesignSessionItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TaskAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "memberId" TEXT,
    "agentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "designSessionItemId" TEXT,
    CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskAssignment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskAssignment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskAssignment_designSessionItemId_fkey" FOREIGN KEY ("designSessionItemId") REFERENCES "DesignSessionItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TaskAssignment" ("agentId", "createdAt", "id", "memberId", "taskId") SELECT "agentId", "createdAt", "id", "memberId", "taskId" FROM "TaskAssignment";
DROP TABLE "TaskAssignment";
ALTER TABLE "new_TaskAssignment" RENAME TO "TaskAssignment";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "DesignSessionStepData_sessionId_stepKey_key" ON "DesignSessionStepData"("sessionId", "stepKey");
