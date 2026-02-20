"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { LogoutButton } from "@/app/components/logout-button";
import type { InstructionalDesignOutput } from "@/lib/validators/output-schema";
import type { QualityReport } from "@/lib/validators/quality";

interface VersionSummary {
  id: string;
  versionNumber: number;
  createdAt: string;
  tokenInput: number;
  tokenOutput: number;
  estimatedCostUsd: number;
  fromCache: boolean;
  generationParams: {
    model?: string;
    safetyMode?: "normal" | "estricto";
    template?: "general" | "curso-corporativo" | "curso-academico" | "microlearning";
    mode?: "full" | "evaluation-only" | "ova-storyboard";
  };
  response: InstructionalDesignOutput;
  qualityReport: QualityReport;
}

interface ProjectResultViewProps {
  project: {
    id: string;
    name: string;
    audience: string;
    level: string;
    modality: string;
    durationHours: number;
  };
  currentVersionId: string;
  selected: VersionSummary;
  versions: VersionSummary[];
}

const SECTION_OPTIONS = [
  { value: "all", label: "Todo el diseño" },
  { value: "course_structure", label: "Estructura del curso" },
  { value: "learning_activities", label: "Actividades" },
  { value: "assessment", label: "Evaluación" },
  { value: "alignment_matrix", label: "Matriz de alineación" },
  { value: "production_notes", label: "Notas de producción" }
] as const;

function toStageLabel(stage: string): string {
  const map: Record<string, string> = {
    queued: "En cola",
    accepted: "Aceptado",
    validating: "Validación",
    storage: "Almacenamiento",
    cache_lookup: "Consulta de caché",
    cache_hit: "Caché encontrada",
    cache_miss: "Sin caché",
    model_request: "Generación IA",
    model_repair: "Normalización de salida",
    storyboard_enrich: "Compleción storyboard",
    quality_check: "Chequeo de calidad",
    persisting: "Persistencia",
    completed: "Completado"
  };

  return map[stage] ?? "Progreso";
}

function resolveInitialModel(model?: string): string {
  const normalized = (model ?? "").toLowerCase().trim();
  if (!normalized) return "gemini-2.5-pro";
  if (normalized.includes("flash")) return "gemini-2.5-pro";
  if (normalized === "gemini-3" || normalized === "gemini3" || normalized === "gemini-3-pro") {
    return "gemini-2.5-pro";
  }
  return model ?? "gemini-2.5-pro";
}

export function ProjectResultView(props: ProjectResultViewProps) {
  const { project, selected, versions, currentVersionId } = props;
  const router = useRouter();

  const [editInstruction, setEditInstruction] = useState("");
  const [targetSection, setTargetSection] = useState<(typeof SECTION_OPTIONS)[number]["value"]>("all");
  const [model, setModel] = useState(resolveInitialModel(selected.generationParams.model));
  const [safetyMode, setSafetyMode] = useState<"normal" | "estricto">(
    selected.generationParams.safetyMode ?? "normal"
  );
  const [template, setTemplate] = useState<"general" | "curso-corporativo" | "curso-academico" | "microlearning">(
    selected.generationParams.template ?? "general"
  );
  const [mode, setMode] = useState<"full" | "evaluation-only" | "ova-storyboard">(
    selected.generationParams.mode ?? "full"
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refineRequestId, setRefineRequestId] = useState<string | null>(null);
  const [refineProgress, setRefineProgress] = useState<
    Array<{ stage: string; message: string; createdAt: number }>
  >([]);

  const qualityBadgeClass = useMemo(() => {
    if (selected.qualityReport.overallScore >= 85) {
      return "bg-emerald-100 text-emerald-700";
    }
    if (selected.qualityReport.overallScore >= 70) {
      return "bg-amber-100 text-amber-700";
    }
    return "bg-rose-100 text-rose-700";
  }, [selected.qualityReport.overallScore]);

  async function onRefine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    setRefineRequestId(null);
    setRefineProgress([
      {
        stage: toStageLabel("queued"),
        message: "Solicitud enviada. Preparando conexión en vivo...",
        createdAt: Date.now()
      }
    ]);

    try {
      const response = await fetch("/api/generate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestType: "refine",
          projectId: project.id,
          baseVersionId: selected.id,
          editInstruction,
          targetSection,
          options: {
            model,
            safetyMode,
            template,
            mode
          }
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
              details?: string[];
            }
          | null;

        const detail = payload?.details?.length ? ` ${payload.details.join(" | ")}` : "";
        setError(`${payload?.error ?? "No fue posible aplicar la edición guiada."}${detail}`);
        return;
      }

      if (!response.body) {
        setError("El navegador no soporta streaming de respuesta para esta acción.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      let streamFailed = false;

      while (!completed) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");

        while (boundary !== -1) {
          const rawEvent = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");

          if (!rawEvent) {
            continue;
          }

          let eventType = "message";
          const dataLines: string[] = [];
          for (const line of rawEvent.split("\n")) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).trim());
            }
          }

          const rawData = dataLines.join("\n");
          let payload: Record<string, unknown> = {};
          try {
            payload = rawData ? (JSON.parse(rawData) as Record<string, unknown>) : {};
          } catch {
            payload = {};
          }

          if (typeof payload.requestId === "string") {
            setRefineRequestId(payload.requestId);
          }

          if (eventType === "status") {
            const stage = typeof payload.stage === "string" ? payload.stage : "status";
            const message =
              typeof payload.message === "string" ? payload.message : "Actualización de progreso disponible.";

            setRefineProgress((prev) => [
              ...prev,
              {
                stage: toStageLabel(stage),
                message,
                createdAt: Date.now()
              }
            ]);
            continue;
          }

          if (eventType === "error") {
            const message =
              typeof payload.error === "string"
                ? payload.error
                : "No fue posible aplicar la edición guiada en modo en vivo.";
            setError(message);
            streamFailed = true;
            completed = true;
            break;
          }

          if (eventType === "complete") {
            const versionId = typeof payload.versionId === "string" ? payload.versionId : selected.id;
            setEditInstruction("");
            setRefineProgress((prev) => [
              ...prev,
              {
                stage: toStageLabel("completed"),
                message: "Regeneración completada. Redirigiendo a la nueva versión...",
                createdAt: Date.now()
              }
            ]);
            router.push(`/projects/${project.id}?version=${versionId}`);
            router.refresh();
            completed = true;
            break;
          }
        }
      }

      if (!completed && !streamFailed) {
        setError("La conexión en vivo terminó antes de recibir el resultado final.");
      }
    } catch {
      setError("Error de red durante la regeneración parcial.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell space-y-6">
      <header className="panel flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{project.name}</h1>
          <p className="mt-1 text-sm text-slate-600">{project.audience}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded bg-slate-100 px-2 py-1 text-slate-700">Nivel: {project.level}</span>
            <span className="rounded bg-slate-100 px-2 py-1 text-slate-700">Modalidad: {project.modality}</span>
            <span className="rounded bg-slate-100 px-2 py-1 text-slate-700">Duración: {project.durationHours} h</span>
            <span className={`rounded px-2 py-1 font-medium ${qualityBadgeClass}`}>
              Calidad: {selected.qualityReport.overallScore}/100
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/projects/new"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Nuevo proyecto
          </Link>
          <LogoutButton />
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <article className="panel">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Resultado v{selected.versionNumber}</h2>
              <div className="flex gap-2">
                <a
                  href={`/api/versions/${selected.id}/export?format=json`}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
                >
                  Exportar JSON
                </a>
                <a
                  href={`/api/versions/${selected.id}/export?format=md`}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
                >
                  Exportar Markdown
                </a>
                <a
                  href={`/api/versions/${selected.id}/export?format=pptx`}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
                >
                  Exportar PPTX
                </a>
                <a
                  href={`/api/versions/${selected.id}/export?format=package`}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
                >
                  Exportar paquete
                </a>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Costo estimado</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">${selected.estimatedCostUsd.toFixed(6)} USD</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Tokens entrada/salida</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {selected.tokenInput} / {selected.tokenOutput}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Caché</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{selected.fromCache ? "Sí" : "No"}</p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Objetivos de aprendizaje (Bloom)</h3>
                <ul className="mt-2 space-y-2">
                  {selected.response.learning_outcomes.map((outcome) => (
                    <li key={outcome.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                      <p className="font-medium text-slate-900">
                        {outcome.id} - {outcome.bloom_level}
                      </p>
                      <p className="mt-1 text-slate-700">{outcome.statement}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-900">Mapa instruccional y secuencia</h3>
                <div className="mt-2 space-y-3">
                  {selected.response.course_structure.map((unit) => (
                    <article key={unit.unit_id} className="rounded-lg border border-slate-200 p-3 text-sm">
                      <p className="font-semibold text-slate-900">
                        {unit.unit_id} - {unit.title} ({unit.duration_minutes} min)
                      </p>
                      <p className="mt-1 text-slate-700">{unit.purpose}</p>
                      <p className="mt-2 text-xs text-slate-500">Resultados: {unit.outcomes.join(", ")}</p>
                      <p className="mt-2 font-medium text-slate-800">Actividades</p>
                      <ul className="mt-1 space-y-1 text-slate-700">
                        {unit.learning_activities.map((activity, index) => (
                          <li key={`${unit.unit_id}-activity-${index}`}>
                            - {activity.type}: {activity.description} ({activity.modality}, {activity.estimated_minutes} min)
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 font-medium text-slate-800">Evaluación</p>
                      <ul className="mt-1 space-y-1 text-slate-700">
                        {unit.assessment.map((assessment, index) => (
                          <li key={`${unit.unit_id}-assessment-${index}`}>
                            - {assessment.type}: {assessment.description}
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-900">Matriz de alineación</h3>
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-slate-600">Resultado</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600">Actividades</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600">Evaluaciones</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600">Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selected.response.alignment_matrix.map((row) => (
                        <tr key={row.outcome_id}>
                          <td className="px-3 py-2 text-slate-900">{row.outcome_id}</td>
                          <td className="px-3 py-2 text-slate-700">{row.activities.join(", ") || "N/D"}</td>
                          <td className="px-3 py-2 text-slate-700">{row.assessments.join(", ") || "N/D"}</td>
                          <td className="px-3 py-2 text-slate-700">{row.alignment_score_0_100}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </article>

          <article className="panel">
            <h2 className="text-lg font-semibold text-slate-900">Edición guiada</h2>
            <p className="mt-1 text-sm text-slate-600">
              Ajusta solo una parte del diseño sin rehacer todo. Ejemplo: "reduce duración a 6 horas" o "más evaluación formativa".
            </p>

            <form onSubmit={onRefine} className="mt-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label">Sección a regenerar</label>
                  <select
                    className="field"
                    value={targetSection}
                    onChange={(event) =>
                      setTargetSection(event.target.value as (typeof SECTION_OPTIONS)[number]["value"])
                    }
                  >
                    {SECTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Modelo Gemini</label>
                  <input className="field" value={model} onChange={(event) => setModel(event.target.value)} required />
                </div>
                <div>
                  <label className="label">Modo de seguridad</label>
                  <select
                    className="field"
                    value={safetyMode}
                    onChange={(event) => setSafetyMode(event.target.value as "normal" | "estricto")}
                  >
                    <option value="normal">Normal</option>
                    <option value="estricto">Estricto</option>
                  </select>
                </div>
                <div>
                  <label className="label">Plantilla</label>
                  <select
                    className="field"
                    value={template}
                    onChange={(event) =>
                      setTemplate(
                        event.target.value as
                          | "general"
                          | "curso-corporativo"
                          | "curso-academico"
                          | "microlearning"
                      )
                    }
                  >
                    <option value="general">General</option>
                    <option value="curso-corporativo">Curso corporativo</option>
                    <option value="curso-academico">Curso académico</option>
                    <option value="microlearning">Microlearning</option>
                  </select>
                </div>
                <div>
                  <label className="label">Modo</label>
                  <select
                    className="field"
                    value={mode}
                    onChange={(event) =>
                      setMode(event.target.value as "full" | "evaluation-only" | "ova-storyboard")
                    }
                  >
                    <option value="full">Diseño completo</option>
                    <option value="evaluation-only">Solo plan de evaluación</option>
                    <option value="ova-storyboard">Storyboard OVA</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Instrucción de ajuste</label>
                <textarea
                  className="field min-h-[110px]"
                  value={editInstruction}
                  onChange={(event) => setEditInstruction(event.target.value)}
                  placeholder="Ejemplo: reduce la duración total a 6 horas y agrega una simulación práctica por unidad."
                  required
                />
              </div>

              {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

              <button
                type="submit"
                disabled={loading || editInstruction.trim().length < 5}
                className="rounded-lg bg-accent px-4 py-2 font-medium text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? "Regenerando en vivo..." : "Aplicar edición guiada"}
              </button>
            </form>

            {(loading || refineProgress.length > 0) && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-900">Progreso en vivo</p>
                {refineRequestId ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Request ID: <span className="font-mono">{refineRequestId}</span>
                  </p>
                ) : null}
                <ul className="mt-2 space-y-2">
                  {refineProgress.map((item, index) => (
                    <li
                      key={`${item.stage}-${item.createdAt}-${index}`}
                      className="rounded bg-white px-3 py-2 text-sm text-slate-700"
                    >
                      <p className="font-medium text-slate-900">{item.stage}</p>
                      <p>{item.message}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        </div>

        <aside className="space-y-6">
          <article className="panel">
            <h2 className="text-lg font-semibold text-slate-900">Panel de calidad</h2>
            <ul className="mt-3 space-y-2">
              {selected.qualityReport.items.map((item) => {
                const itemClass =
                  item.status === "ok"
                    ? "bg-emerald-50 text-emerald-700"
                    : item.status === "warning"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-rose-50 text-rose-700";

                return (
                  <li key={item.id} className={`rounded-lg px-3 py-2 text-sm ${itemClass}`}>
                    <p className="font-medium">{item.label}</p>
                    <p className="mt-1">{item.detail}</p>
                  </li>
                );
              })}
            </ul>

            {selected.qualityReport.fixSuggestions.length > 0 ? (
              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                <p className="font-medium text-slate-900">Sugerencias de mejora</p>
                <ul className="mt-2 space-y-1">
                  {selected.qualityReport.fixSuggestions.map((suggestion, index) => (
                    <li key={`fix-${index}`}>- {suggestion}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {selected.qualityReport.editorialChecklist?.length ? (
              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                <p className="font-medium text-slate-900">Checklist editorial (manual)</p>
                <ul className="mt-2 space-y-1">
                  {selected.qualityReport.editorialChecklist.map((item) => (
                    <li key={item.id}>- {item.label}: {item.detail}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>

          <article className="panel">
            <h2 className="text-lg font-semibold text-slate-900">Versiones</h2>
            <div className="mt-3 space-y-2">
              {versions.map((version) => {
                const active = version.id === currentVersionId;

                return (
                  <Link
                    key={version.id}
                    href={`/projects/${project.id}?version=${version.id}`}
                    className={`block rounded-lg border px-3 py-2 text-sm transition ${
                      active
                        ? "border-accent bg-cyan-50 text-cyan-900"
                        : "border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <p className="font-medium">Versión {version.versionNumber}</p>
                    <p className="mt-1 text-xs opacity-80">{new Date(version.createdAt).toLocaleString("es-CO")}</p>
                    <p className="mt-1 text-xs opacity-80">{version.fromCache ? "Caché" : "Generación nueva"}</p>
                  </Link>
                );
              })}
            </div>
          </article>
        </aside>
      </section>
    </main>
  );
}
