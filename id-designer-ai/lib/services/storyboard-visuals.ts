import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import { ensureCourseFolderLocal } from "@/lib/local/course-folders";
import { searchOpenverseImage } from "@/lib/openverse/client";

export interface ResolvedVisual {
  imagePath: string;
  attributionLines: string[];
  watermarkLabel?: string;
  provider?: string;
}

function sha256Short(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function contentTypeToExt(contentType: string | null): string {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("image/png")) return ".png";
  if (ct.includes("image/webp")) return ".webp";
  if (ct.includes("image/jpeg") || ct.includes("image/jpg")) return ".jpg";
  return ".img";
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveAssetsDir(courseName: string): Promise<string> {
  // Prefer the local course directory if configured, otherwise use /tmp.
  try {
    const local = await ensureCourseFolderLocal(courseName);
    if (local.enabled && !local.skipped) {
      const dir = path.join(local.folderPath, "assets");
      await fs.mkdir(dir, { recursive: true });
      return dir;
    }
  } catch {
    // Ignore and fallback to /tmp.
  }

  const tmpRoot = process.env.TMPDIR || "/tmp";
  const dir = path.join(tmpRoot, "id-designer-ai", "assets");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

const inMemoryCache = new Map<string, Promise<ResolvedVisual | null>>();

export async function resolveStoryboardVisual(params: {
  courseName: string;
  term: string;
  preferHorizontal?: boolean;
}): Promise<ResolvedVisual | null> {
  // Avoid external calls in unit tests.
  if (process.env.NODE_ENV === "test") return null;

  const term = params.term.trim();
  if (!term) return null;

  const cacheKey = `${params.courseName}::${term}::${params.preferHorizontal ?? true}`;
  const existing = inMemoryCache.get(cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<ResolvedVisual | null> => {
    try {
      const assetsDir = await resolveAssetsDir(params.courseName);
      const preferHorizontal = params.preferHorizontal ?? true;
      const base = sha256Short(`openverse|${term}|${preferHorizontal}`);
      const metaPath = path.join(assetsDir, `${base}.meta.json`);

      if (await pathExists(metaPath)) {
        try {
          const meta = JSON.parse(await fs.readFile(metaPath, "utf8")) as any;
          const fileName = typeof meta?.fileName === "string" ? meta.fileName : "";
          const imagePath = fileName ? path.join(assetsDir, fileName) : "";
          if (imagePath && (await pathExists(imagePath))) {
            const attributionLines = Array.isArray(meta?.attributionLines)
              ? meta.attributionLines.map((line: unknown) => String(line))
              : [];
            const watermarkLabel = typeof meta?.watermarkLabel === "string" ? meta.watermarkLabel : undefined;
            const provider = typeof meta?.provider === "string" ? meta.provider : undefined;
            return { imagePath, attributionLines, watermarkLabel, provider };
          }
        } catch {
          // If meta is corrupted, ignore and refetch.
        }
      }

      // Image provider: Openverse (no API key required).
      const openverse = await searchOpenverseImage({ term, preferHorizontal, pageSize: 25 });
      const imageUrl = openverse?.imageUrl ?? "";
      if (!imageUrl) return null;

      const imageRes = await fetch(imageUrl, { method: "GET" });
      if (!imageRes.ok) return null;

      const arrayBuffer = await imageRes.arrayBuffer();
      const ext = contentTypeToExt(imageRes.headers.get("content-type"));
      const fileName = `${base}${ext}`;
      const imagePath = path.join(assetsDir, fileName);

      await fs.writeFile(imagePath, Buffer.from(arrayBuffer));

      const attributionLines: string[] = [];
      const provider: string = "openverse";
      const watermarkLabel: string | undefined = "PREVISUALIZACION";

      attributionLines.push(`Imagen: ${openverse?.title ?? "N/D"}`);
      attributionLines.push(`Fuente: ${openverse?.pageUrl ?? openverse?.imageUrl ?? "N/D"}`);
      if (openverse?.creator) attributionLines.push(`Autor: ${openverse.creator}`);
      if (openverse?.license) attributionLines.push(`Licencia: ${openverse.license}`);
      if (openverse?.licenseUrl) attributionLines.push(`Licencia URL: ${openverse.licenseUrl}`);
      if (openverse?.provider) attributionLines.push(`Proveedor: ${openverse.provider}`);

      await fs.writeFile(
        metaPath,
        JSON.stringify(
          {
            provider,
            term,
            id: openverse?.id ?? "unknown",
            fileName,
            fetchedAt: new Date().toISOString(),
            pageUrl: openverse?.pageUrl ?? null,
            imageUrl,
            attributionLines,
            watermarkLabel
          },
          null,
          2
        ),
        "utf8"
      );

      return { imagePath, attributionLines, watermarkLabel, provider };
    } catch {
      // Best-effort: never break PPTX generation on visuals.
      return null;
    }
  })();

  inMemoryCache.set(cacheKey, promise);
  return promise;
}

// Backwards compatibility for older imports.
export const resolveFreepikVisual = resolveStoryboardVisual;
