/*
  Warnings:

  - You are about to drop the `DesignSessionStakeholder` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "DesignSessionStakeholder";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DesignSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'inception',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "totalSteps" INTEGER NOT NULL DEFAULT 6,
    "scheduledAt" DATETIME,
    "completedAt" DATETIME,
    "actualDurationMin" INTEGER,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DesignSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DesignSession_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Member" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DesignSession" ("actualDurationMin", "completedAt", "createdAt", "createdBy", "currentStep", "description", "id", "projectId", "scheduledAt", "status", "title", "totalSteps", "type", "updatedAt") SELECT "actualDurationMin", "completedAt", "createdAt", "createdBy", "currentStep", "description", "id", "projectId", "scheduledAt", "status", "title", "totalSteps", "type", "updatedAt" FROM "DesignSession";
DROP TABLE "DesignSession";
ALTER TABLE "new_DesignSession" RENAME TO "DesignSession";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
