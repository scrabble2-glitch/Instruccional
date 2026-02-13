import { isAuthenticated } from "@/lib/auth/session";
import { ensureCourseFolderLocal } from "@/lib/local/course-folders";
import { prisma } from "@/lib/prisma";
import { ensureDatabaseReady } from "@/lib/services/db-init";
import { toMarkdown } from "@/lib/services/markdown-export";
import { toPptxBuffer } from "@/lib/services/pptx-export";
import { parseStoredJson } from "@/lib/utils/json-store";
import { jsonResponse } from "@/lib/utils/request";
import { sanitizeText } from "@/lib/utils/sanitize";
import { InstructionalDesignOutputSchema } from "@/lib/validators/output-schema";
import path from "path";
import { promises as fs } from "fs";

interface RouteContext {
  params: { id: string };
}

export const runtime = "nodejs";

function safeExportBaseName(courseName: string, versionNumber: number): string {
  const cleaned = sanitizeText(courseName);
  const replaced = cleaned
    // Prevent path separators and unsafe characters.
    .replaceAll("/", "-")
    .replaceAll("\\", "-")
    .replace(/[:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim()
    .toLowerCase();

  const limited = replaced.length > 80 ? replaced.slice(0, 80).trim() : replaced;
  const base = limited && limited !== "." && limited !== ".." ? limited : "curso";
  return `${base}-v${versionNumber}`;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  if (!isAuthenticated(request)) {
    return jsonResponse({ error: "No autorizado." }, 401);
  }

  await ensureDatabaseReady();

  const format = new URL(request.url).searchParams.get("format") ?? "json";

  const version = await prisma.version.findUnique({
    where: { id: context.params.id },
    select: {
      id: true,
      versionNumber: true,
      responseJson: true,
      project: {
        select: {
          name: true
        }
      }
    }
  });

  if (!version) {
    return jsonResponse({ error: "Versión no encontrada." }, 404);
  }

  const output = InstructionalDesignOutputSchema.parse(
    parseStoredJson<unknown>(version.responseJson, `Version ${version.id} responseJson`)
  );
  const baseName = safeExportBaseName(version.project.name, version.versionNumber);

  if (format === "md") {
    const markdown = toMarkdown(output);
    return new Response(markdown, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"${baseName}.md\"`
      }
    });
  }

  if (format === "pptx") {
    const buffer = await toPptxBuffer(output);

    // Best-effort: store a copy in the local course folder, if configured.
    try {
      const local = await ensureCourseFolderLocal(version.project.name);
      if (local.enabled && !local.skipped) {
        await fs.writeFile(path.join(local.folderPath, `${baseName}.pptx`), buffer);
      }
    } catch {
      // Do not block download if local persistence fails.
    }

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename=\"${baseName}.pptx\"`
      }
    });
  }

  return new Response(JSON.stringify(output, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${baseName}.json\"`
    }
  });
}
