import { promises as fs } from "fs";
import path from "path";
import { env } from "@/lib/env";
import { sanitizeText } from "@/lib/utils/sanitize";

function safeFolderName(courseName: string): string {
  const cleaned = sanitizeText(courseName);
  const replaced = cleaned
    // Prevent path traversal and path separators.
    .replaceAll("/", "-")
    .replaceAll("\\", "-")
    // Common forbidden chars on Windows (keeps things portable).
    .replace(/[:*?"<>|]/g, "-")
    .trim();

  const collapsed = replaced.replace(/-+/g, "-").trim();
  const limited = collapsed.length > 80 ? collapsed.slice(0, 80).trim() : collapsed;

  if (!limited || limited === "." || limited === "..") {
    return "curso";
  }

  return limited;
}

function resolveCourseFolderPath(rootDir: string, folderName: string): string {
  const root = path.resolve(rootDir);
  const target = path.resolve(root, folderName);

  // Ensure the target stays within root (avoid ".." edge cases).
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Ruta de carpeta local inválida.");
  }

  return target;
}

function isLocalCourseDirConfigured(): boolean {
  return Boolean(env.LOCAL_COURSE_ROOT_DIR && env.LOCAL_COURSE_ROOT_DIR.trim().length > 0);
}

export async function ensureCourseFolderLocal(courseName: string): Promise<
  | { enabled: false; skipped: true; reason: string }
  | { enabled: true; skipped: false; folderPath: string }
> {
  if (!isLocalCourseDirConfigured()) {
    return {
      enabled: false,
      skipped: true,
      reason: "Carpeta local no configurada (LOCAL_COURSE_ROOT_DIR vacío)."
    };
  }

  const folderName = safeFolderName(courseName);
  const folderPath = resolveCourseFolderPath(env.LOCAL_COURSE_ROOT_DIR, folderName);

  await fs.mkdir(folderPath, { recursive: true });

  // Marker file for tooling and to make empty folders visible in some contexts.
  try {
    await fs.writeFile(path.join(folderPath, ".keep"), "", { flag: "a" });
  } catch {
    // Best-effort: folder already exists or is writable.
  }

  return {
    enabled: true,
    skipped: false,
    folderPath
  };
}

