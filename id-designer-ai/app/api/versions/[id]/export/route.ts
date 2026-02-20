import { isAuthenticated } from "@/lib/auth/session";
import { ensureCourseFolderLocal } from "@/lib/local/course-folders";
import { prisma } from "@/lib/prisma";
import { ensureDatabaseReady } from "@/lib/services/db-init";
import { buildDeliveryPackage } from "@/lib/services/delivery-package";
import { toMarkdown } from "@/lib/services/markdown-export";
import { toPptxBuffer } from "@/lib/services/pptx-export";
import { parseStoredJson } from "@/lib/utils/json-store";
import { jsonResponse } from "@/lib/utils/request";
import { sanitizeText } from "@/lib/utils/sanitize";
import { InstructionalDesignOutputSchema } from "@/lib/validators/output-schema";
import { QualityReport } from "@/lib/validators/quality";
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
      generationParams: true,
      qualityReport: true,
      responseJson: true,
      createdAt: true,
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
  const generationParams = parseStoredJson<{ mode?: string; model?: string }>(
    version.generationParams,
    `Version ${version.id} generationParams`
  );
  const qualityReport = parseStoredJson<QualityReport>(
    version.qualityReport,
    `Version ${version.id} qualityReport`
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
    const buffer = await toPptxBuffer(output, { mode: generationParams.mode, courseName: version.project.name });

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

  if (format === "package") {
    const packageBuild = await buildDeliveryPackage({
      baseName,
      courseName: version.project.name,
      versionNumber: version.versionNumber,
      output,
      qualityReport,
      mode: generationParams.mode,
      model: generationParams.model,
      createdAtIso: version.createdAt.toISOString()
    });

    // Best-effort: persist artifacts in local course folder when configured.
    try {
      const local = await ensureCourseFolderLocal(version.project.name);
      if (local.enabled && !local.skipped) {
        const exportRoot = path.join(local.folderPath, "exports");
        await fs.mkdir(exportRoot, { recursive: true });

        for (const artifact of packageBuild.artifacts) {
          const localPath = path.join(exportRoot, artifact.path);
          await fs.mkdir(path.dirname(localPath), { recursive: true });
          await fs.writeFile(localPath, artifact.data);
        }

        await fs.writeFile(path.join(exportRoot, `${baseName}-package.zip`), packageBuild.zipBuffer);
      }
    } catch {
      // Do not block download if local persistence fails.
    }

    return new Response(packageBuild.zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename=\"${baseName}-package.zip\"`
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
