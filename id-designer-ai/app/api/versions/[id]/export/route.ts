import { isAuthenticated } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { ensureDatabaseReady } from "@/lib/services/db-init";
import { toMarkdown } from "@/lib/services/markdown-export";
import { parseStoredJson } from "@/lib/utils/json-store";
import { jsonResponse } from "@/lib/utils/request";
import { InstructionalDesignOutputSchema } from "@/lib/validators/output-schema";

interface RouteContext {
  params: { id: string };
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
  const baseName = `${version.project.name.replace(/\s+/g, "-").toLowerCase()}-v${version.versionNumber}`;

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

  return new Response(JSON.stringify(output, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${baseName}.json\"`
    }
  });
}
