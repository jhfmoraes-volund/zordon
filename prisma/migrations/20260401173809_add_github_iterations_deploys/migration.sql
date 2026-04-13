/*
  Warnings:

  - You are about to drop the column `mode` on the `Squad` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Sprint" ADD COLUMN "deployedToProductionAt" DATETIME;
ALTER TABLE "Sprint" ADD COLUMN "deployedToStagingAt" DATETIME;

-- CreateTable
CREATE TABLE "TaskIteration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'initial',
    "trigger" TEXT NOT NULL DEFAULT 'system',
    "promptSent" TEXT,
    "resultSummary" TEXT,
    "commitSha" TEXT,
    "costInputTokens" INTEGER NOT NULL DEFAULT 0,
    "costOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "errorLog" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "TaskIteration_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SprintDeploy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sprintId" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'staging',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tasksIncluded" TEXT NOT NULL DEFAULT '[]',
    "tasksFailed" TEXT NOT NULL DEFAULT '[]',
    "triggeredBy" TEXT,
    "commitSha" TEXT,
    "errorLog" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "SprintDeploy_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "repoUrl" TEXT,
    "slaHours" INTEGER NOT NULL DEFAULT 48,
    "deadline" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "githubRepoOwner" TEXT,
    "githubRepoName" TEXT,
    "githubDefaultBranch" TEXT NOT NULL DEFAULT 'main',
    "clientId" TEXT NOT NULL,
    CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("clientId", "createdAt", "deadline", "id", "name", "repoUrl", "slaHours", "status", "updatedAt") SELECT "clientId", "createdAt", "deadline", "id", "name", "repoUrl", "slaHours", "status", "updatedAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE TABLE "new_Squad" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Squad" ("createdAt", "id", "name", "updatedAt") SELECT "createdAt", "id", "name", "updatedAt" FROM "Squad";
DROP TABLE "Squad";
ALTER TABLE "new_Squad" RENAME TO "Squad";
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'backlog',
    "complexity" TEXT NOT NULL DEFAULT 'medium',
    "scope" TEXT NOT NULL DEFAULT 'small',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "executionMode" TEXT NOT NULL DEFAULT 'manual',
    "githubIssueNumber" INTEGER,
    "githubBranchName" TEXT,
    "githubPrNumber" INTEGER,
    "githubPrUrl" TEXT,
    "mergeAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastMergeError" TEXT,
    "projectId" TEXT NOT NULL,
    "sprintId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("complexity", "createdAt", "description", "id", "priority", "projectId", "reference", "scope", "sprintId", "status", "title", "updatedAt") SELECT "complexity", "createdAt", "description", "id", "priority", "projectId", "reference", "scope", "sprintId", "status", "title", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE UNIQUE INDEX "Task_reference_key" ON "Task"("reference");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
