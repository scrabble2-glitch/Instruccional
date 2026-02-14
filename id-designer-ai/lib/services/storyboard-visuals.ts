import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import { ensureCourseFolderLocal } from "@/lib/local/course-folders";
import { searchFreepikImage } from "@/lib/freepik/client";

export interface ResolvedVisual {
  imagePath: string;
  attributionLines: string[];
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

export async function resolveFreepikVisual(params: {
  courseName: string;
  term: string;
  preferHorizontal?: boolean;
}): Promise<ResolvedVisual | null> {
  const term = params.term.trim();
  if (!term) return null;

  const cacheKey = `${params.courseName}::${term}::${params.preferHorizontal ?? true}`;
  const existing = inMemoryCache.get(cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<ResolvedVisual | null> => {
    try {
      const assetsDir = await resolveAssetsDir(params.courseName);
      const base = sha256Short(`freepik|${term}|${params.preferHorizontal ?? true}`);
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
            return { imagePath, attributionLines };
          }
        } catch {
          // If meta is corrupted, ignore and refetch.
        }
      }

      const found = await searchFreepikImage({
        term,
        preferHorizontal: params.preferHorizontal ?? true,
        limit: 16
      });

      if (!found) return null;

      const imageRes = await fetch(found.imageUrl, { method: "GET" });
      if (!imageRes.ok) return null;

      const arrayBuffer = await imageRes.arrayBuffer();
      const ext = contentTypeToExt(imageRes.headers.get("content-type"));
      const fileName = `${base}${ext}`;
      const imagePath = path.join(assetsDir, fileName);

      await fs.writeFile(imagePath, Buffer.from(arrayBuffer));

      const attributionLines: string[] = [];
      attributionLines.push(`Imagen: ${found.title}`);
      attributionLines.push(`Fuente: ${found.pageUrl ?? found.imageUrl}`);
      if (found.authorName) attributionLines.push(`Autor: ${found.authorName}`);
      if (found.licenseUrl) attributionLines.push(`Licencia: ${found.licenseUrl}`);

      await fs.writeFile(
        metaPath,
        JSON.stringify(
          {
            provider: "freepik",
            term,
            id: found.id,
            fileName,
            fetchedAt: new Date().toISOString(),
            pageUrl: found.pageUrl,
            imageUrl: found.imageUrl,
            attributionLines
          },
          null,
          2
        ),
        "utf8"
      );

      return { imagePath, attributionLines };
    } catch {
      // Best-effort: never break PPTX generation on visuals.
      return null;
    }
  })();

  inMemoryCache.set(cacheKey, promise);
  return promise;
}

