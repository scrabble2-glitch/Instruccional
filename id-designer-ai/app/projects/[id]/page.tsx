import { notFound } from "next/navigation";
import { ProjectResultView } from "@/app/components/project-result-view";
import { prisma } from "@/lib/prisma";
import { ensureDatabaseReady } from "@/lib/services/db-init";
import { parseStoredJson } from "@/lib/utils/json-store";
import { InstructionalDesignOutputSchema } from "@/lib/validators/output-schema";
import { QualityReport } from "@/lib/validators/quality";

export const dynamic = "force-dynamic";

interface ProjectPageProps {
  params: { id: string };
  searchParams: { version?: string };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asSafetyMode(value: unknown): "normal" | "estricto" | undefined {
  return value === "normal" || value === "estricto" ? value : undefined;
}

function asTemplate(
  value: unknown
): "general" | "curso-corporativo" | "curso-academico" | "microlearning" | undefined {
  return value === "general" ||
    value === "curso-corporativo" ||
    value === "curso-academico" ||
    value === "microlearning"
    ? value
    : undefined;
}

function asMode(value: unknown): "full" | "evaluation-only" | "ova-storyboard" | undefined {
  return value === "full" || value === "evaluation-only" || value === "ova-storyboard"
    ? value
    : undefined;
}

function normalizeQualityReport(value: unknown): QualityReport {
  const fallback: QualityReport = {
    overallScore: 0,
    items: [],
    issues: [],
    fixSuggestions: [],
    editorialChecklist: []
  };

  if (!value || typeof value !== "object") {
    return fallback;
  }

  const candidate = value as Partial<QualityReport>;

  return {
    overallScore: typeof candidate.overallScore === "number" ? candidate.overallScore : 0,
    items: Array.isArray(candidate.items) ? candidate.items : [],
    issues: Array.isArray(candidate.issues) ? candidate.issues : [],
    fixSuggestions: Array.isArray(candidate.fixSuggestions) ? candidate.fixSuggestions : [],
    editorialChecklist: Array.isArray(candidate.editorialChecklist) ? candidate.editorialChecklist : []
  };
}

export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  if (!params?.id) {
    notFound();
  }

  await ensureDatabaseReady();

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    include: {
      versions: {
        orderBy: { versionNumber: "desc" }
      }
    }
  });

  if (!project) {
    notFound();
  }

  if (project.versions.length === 0) {
    return (
      <main className="page-shell">
        <div className="panel">
          <h1 className="text-xl font-semibold text-slate-900">Proyecto sin versiones</h1>
          <p className="mt-2 text-sm text-slate-700">Este proyecto aún no tiene resultados generados.</p>
        </div>
      </main>
    );
  }

  const selectedVersion =
    project.versions.find((version) => version.id === searchParams.version) ?? project.versions[0];

  const viewVersions = project.versions.map((version) => {
    const responsePayload = parseStoredJson<unknown>(
      version.responseJson,
      `Version ${version.id} responseJson`
    );
    const parsedResponse = InstructionalDesignOutputSchema.safeParse(responsePayload);
    const parsedQuality = normalizeQualityReport(
      parseStoredJson<unknown>(version.qualityReport, `Version ${version.id} qualityReport`)
    );

    if (!parsedResponse.success) {
      throw new Error(`Versión ${version.id} tiene JSON inválido en base de datos.`);
    }

    const paramsRecord = parseStoredJson<Record<string, unknown>>(
      version.generationParams,
      `Version ${version.id} generationParams`
    );

    return {
      id: version.id,
      versionNumber: version.versionNumber,
      createdAt: version.createdAt.toISOString(),
      tokenInput: version.tokenInput,
      tokenOutput: version.tokenOutput,
      estimatedCostUsd: version.estimatedCostUsd,
      fromCache: version.fromCache,
      generationParams: {
        model: asString(paramsRecord.model),
        safetyMode: asSafetyMode(paramsRecord.safetyMode),
        template: asTemplate(paramsRecord.template),
        mode: asMode(paramsRecord.mode)
      },
      response: parsedResponse.data,
      qualityReport: parsedQuality
    };
  });

  const selected = viewVersions.find((version) => version.id === selectedVersion.id) ?? viewVersions[0];

  return (
    <ProjectResultView
      project={{
        id: project.id,
        name: project.name,
        audience: project.audience,
        level: project.level,
        modality: project.modality,
        durationHours: project.durationHours
      }}
      currentVersionId={selected.id}
      selected={selected}
      versions={viewVersions}
    />
  );
}
