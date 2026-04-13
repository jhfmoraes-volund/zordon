/*
  Warnings:

  - You are about to drop the column `projectId` on the `Squad` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "ProjectSquad" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    CONSTRAINT "ProjectSquad_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectSquad_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Squad" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'claude-local',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Squad" ("createdAt", "id", "mode", "name", "updatedAt") SELECT "createdAt", "id", "mode", "name", "updatedAt" FROM "Squad";
DROP TABLE "Squad";
ALTER TABLE "new_Squad" RENAME TO "Squad";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSquad_projectId_squadId_key" ON "ProjectSquad"("projectId", "squadId");
