import { prisma } from "@/lib/prisma";

const globalState = globalThis as unknown as {
  __idDesignerDbInitPromise?: Promise<void>;
};

function isSqliteUrl(url: string | undefined): boolean {
  return Boolean(url && url.startsWith("file:"));
}

async function createSqliteTablesIfNeeded(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Project" (
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
      "preferredModel" TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Version" (
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
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CacheEntry" (
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
  `);

  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "Project_createdAt_idx" ON "Project"("createdAt")'
  );
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "Version_projectId_versionNumber_key" ON "Version"("projectId", "versionNumber")'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "Version_projectId_createdAt_idx" ON "Version"("projectId", "createdAt")'
  );
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "CacheEntry_key_key" ON "CacheEntry"("key")');
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "CacheEntry_expiresAt_idx" ON "CacheEntry"("expiresAt")'
  );
}

export async function ensureDatabaseReady(): Promise<void> {
  if (!isSqliteUrl(process.env.DATABASE_URL)) {
    return;
  }

  if (!globalState.__idDesignerDbInitPromise) {
    globalState.__idDesignerDbInitPromise = createSqliteTablesIfNeeded();
  }

  await globalState.__idDesignerDbInitPromise;
}
