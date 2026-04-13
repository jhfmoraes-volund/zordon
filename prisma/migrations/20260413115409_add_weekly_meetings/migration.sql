/*
  Warnings:

  - You are about to drop the column `deadline` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `slaHours` on the `Project` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "ProjectGuideline" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectGuideline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeeklyMeeting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MeetingProjectReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meetingId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "nextSteps" TEXT,
    "sprintHealth" TEXT NOT NULL DEFAULT 'healthy',
    "attentionPoints" TEXT,
    "additionalNotes" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeetingProjectReview_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "WeeklyMeeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingProjectReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingProjectReview_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MeetingActionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meetingId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "dueDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "sourceReviewId" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeetingActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "WeeklyMeeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingActionItem_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Member" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingActionItem_sourceReviewId_fkey" FOREIGN KEY ("sourceReviewId") REFERENCES "MeetingProjectReview" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Member" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL DEFAULT 'fullstack',
    "githubUsername" TEXT,
    "hourlyCost" REAL NOT NULL DEFAULT 0,
    "fpCapacity" INTEGER NOT NULL DEFAULT 125,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Member" ("createdAt", "email", "githubUsername", "hourlyCost", "id", "name", "role", "updatedAt") SELECT "createdAt", "email", "githubUsername", "hourlyCost", "id", "name", "role", "updatedAt" FROM "Member";
DROP TABLE "Member";
ALTER TABLE "new_Member" RENAME TO "Member";
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "repoUrl" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "contractUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "githubRepoOwner" TEXT,
    "githubRepoName" TEXT,
    "githubDefaultBranch" TEXT NOT NULL DEFAULT 'main',
    "clientId" TEXT NOT NULL,
    "pmId" TEXT,
    CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Project_pmId_fkey" FOREIGN KEY ("pmId") REFERENCES "Member" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("clientId", "createdAt", "githubDefaultBranch", "githubRepoName", "githubRepoOwner", "id", "name", "repoUrl", "status", "updatedAt") SELECT "clientId", "createdAt", "githubDefaultBranch", "githubRepoName", "githubRepoOwner", "id", "name", "repoUrl", "status", "updatedAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'backlog',
    "complexity" TEXT NOT NULL DEFAULT 'medium',
    "scope" TEXT NOT NULL DEFAULT 'small',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "functionPoints" INTEGER,
    "type" TEXT NOT NULL DEFAULT 'feature',
    "dependencies" TEXT,
    "dueDate" DATETIME,
    "executionMode" TEXT NOT NULL DEFAULT 'manual',
    "githubIssueNumber" INTEGER,
    "githubBranchName" TEXT,
    "githubPrNumber" INTEGER,
    "githubPrUrl" TEXT,
    "mergeAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastMergeError" TEXT,
    "acceptanceCriteria" TEXT,
    "businessContext" TEXT,
    "technicalNotes" TEXT,
    "outOfScope" TEXT,
    "uiGuidance" TEXT,
    "designSessionId" TEXT,
    "projectId" TEXT NOT NULL,
    "sprintId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("complexity", "createdAt", "description", "executionMode", "githubBranchName", "githubIssueNumber", "githubPrNumber", "githubPrUrl", "id", "lastMergeError", "mergeAttempts", "priority", "projectId", "reference", "scope", "sprintId", "status", "title", "updatedAt") SELECT "complexity", "createdAt", "description", "executionMode", "githubBranchName", "githubIssueNumber", "githubPrNumber", "githubPrUrl", "id", "lastMergeError", "mergeAttempts", "priority", "projectId", "reference", "scope", "sprintId", "status", "title", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE UNIQUE INDEX "Task_reference_key" ON "Task"("reference");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ProjectGuideline_projectId_category_key" ON "ProjectGuideline"("projectId", "category");
