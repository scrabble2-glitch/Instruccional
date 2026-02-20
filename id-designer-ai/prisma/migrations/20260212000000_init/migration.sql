-- CreateTable
CREATE TABLE "Project" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "durationHours" INTEGER NOT NULL,
  "modality" TEXT NOT NULL,
  "generalObjectives" TEXT NOT NULL,
  "restrictions" TEXT,
  "availableResources" TEXT,
  "pedagogicalApproach" TEXT,
  "evaluationApproach" TEXT,
  "language" TEXT NOT NULL DEFAULT 'es',
  "tone" TEXT NOT NULL DEFAULT 'profesional',
  "preferredModel" TEXT NOT NULL DEFAULT 'gemini-3-pro',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Version" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "promptSystem" TEXT NOT NULL,
  "promptUser" TEXT NOT NULL,
  "generationParams" TEXT NOT NULL,
  "requestPayload" TEXT NOT NULL,
  "responseJson" TEXT NOT NULL,
  "qualityReport" TEXT NOT NULL,
  "tokenInput" INTEGER NOT NULL DEFAULT 0,
  "tokenOutput" INTEGER NOT NULL DEFAULT 0,
  "estimatedCostUsd" REAL NOT NULL DEFAULT 0,
  "cacheKey" TEXT,
  "fromCache" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Version_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CacheEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "safetyMode" TEXT NOT NULL,
  "requestPayload" TEXT NOT NULL,
  "responseJson" TEXT NOT NULL,
  "qualityReport" TEXT NOT NULL,
  "tokenInput" INTEGER NOT NULL DEFAULT 0,
  "tokenOutput" INTEGER NOT NULL DEFAULT 0,
  "estimatedCostUsd" REAL NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Project_createdAt_idx" ON "Project"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Version_projectId_versionNumber_key" ON "Version"("projectId", "versionNumber");
CREATE INDEX "Version_projectId_createdAt_idx" ON "Version"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CacheEntry_key_key" ON "CacheEntry"("key");
CREATE INDEX "CacheEntry_expiresAt_idx" ON "CacheEntry"("expiresAt");
