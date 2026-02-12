"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type GenerateSuccess = {
  projectId: string;
  versionId: string;
};

type LiveProgressEvent = {
  stage: string;
  message: string;
  createdAt: number;
};

interface FormState {
  name: string;
  audience: string;
  level: string;
  durationHours: number;
  modality: "virtual" | "presencial" | "blended";
  generalObjectives: string;
  restrictions: string;
  availableResources: string;
  pedagogicalApproach: string;
  evaluationApproach: string;
  language: string;
  tone: string;
  model: string;
  safetyMode: "normal" | "estricto";
  template: "general" | "curso-corporativo" | "curso-academico" | "microlearning";
  mode: "full" | "evaluation-only" | "ova-storyboard";
}

const DEFAULT_FORM: FormState = {
  name: "",
  audience: "",
  level: "",
  durationHours: 8,
  modality: "virtual",
  generalObjectives: "",
  restrictions: "",
  availableResources: "",
  pedagogicalApproach: "",
  evaluationApproach: "",
  language: "español",
  tone: "profesional",
  model: "gemini-2.5-flash",
  safetyMode: "normal",
  template: "general",
  mode: "full"
};

function toStageLabel(stage: string): string {
  const map: Record<string, string> = {
    queued: "En cola",
    accepted: "Aceptado",
    validating: "Validación",
    cache_lookup: "Consulta de caché",
    cache_hit: "Caché encontrada",
    cache_miss: "Sin caché",
    model_request: "Generación IA",
    model_repair: "Reparación JSON",
    quality_check: "Chequeo de calidad",
    persisting: "Persistencia",
    completed: "Completado"
  };

  return map[stage] ?? "Progreso";
}

export function NewProjectForm() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [liveProgress, setLiveProgress] = useState<LiveProgressEvent[]>([]);
  const [liveSummary, setLiveSummary] = useState<{
    model: string;
    fromCache: boolean;
    tokenInput: number;
    tokenOutput: number;
    estimatedCostUsd: number;
  } | null>(null);
  const router = useRouter();

  const disabled = useMemo(() => loading || !form.name || !form.generalObjectives, [form, loading]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    setRequestId(null);
    setLiveSummary(null);
    setLiveProgress([
      {
        stage: toStageLabel("queued"),
        message: "Solicitud enviada. Preparando conexión en vivo...",
        createdAt: Date.now()
      }
    ]);

    const payload = {
      requestType: "new",
      project: {
        name: form.name,
        audience: form.audience,
        level: form.level,
        durationHours: Number(form.durationHours),
        modality: form.modality,
        generalObjectives: form.generalObjectives,
        restrictions: form.restrictions,
        availableResources: form.availableResources,
        pedagogicalApproach: form.pedagogicalApproach,
        evaluationApproach: form.evaluationApproach,
        language: form.language,
        tone: form.tone
      },
      options: {
        model: form.model,
        safetyMode: form.safetyMode,
        template: form.template,
        mode: form.mode
      }
    };

    try {
      const response = await fetch("/api/generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const payloadError = (await response.json().catch(() => null)) as
          | { error?: string; details?: string[] }
          | null;
        const detail = payloadError?.details?.length ? ` ${payloadError.details.join(" | ")}` : "";
        setError(`${payloadError?.error ?? "No fue posible generar el diseño."}${detail}`);
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
            setRequestId(payload.requestId);
          }

          if (eventType === "status") {
            const stage = typeof payload.stage === "string" ? payload.stage : "status";
            const message =
              typeof payload.message === "string" ? payload.message : "Actualización de progreso disponible.";

            setLiveProgress((prev) => [
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
                : "No fue posible generar el diseño instruccional en modo en vivo.";
            setError(message);
            streamFailed = true;
            completed = true;
            break;
          }

          if (eventType === "complete") {
            const data = payload as unknown as GenerateSuccess & {
              model: string;
              fromCache: boolean;
              tokenInput: number;
              tokenOutput: number;
              estimatedCostUsd: number;
            };

            setLiveSummary({
              model: data.model,
              fromCache: data.fromCache,
              tokenInput: data.tokenInput,
              tokenOutput: data.tokenOutput,
              estimatedCostUsd: data.estimatedCostUsd
            });

            setLiveProgress((prev) => [
              ...prev,
              {
                stage: toStageLabel("completed"),
                message: "Generación finalizada. Redirigiendo al resultado...",
                createdAt: Date.now()
              }
            ]);

            router.push(`/projects/${data.projectId}?version=${data.versionId}`);
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
      setError("Error de red al generar el diseño instruccional.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <section className="panel">
        <h2 className="text-lg font-semibold text-slate-900">Nuevo Proyecto Instruccional</h2>
        <p className="mt-1 text-sm text-slate-600">
          Completa el brief. El sistema generará una propuesta alineada a ADDIE + alineación constructiva.
        </p>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <label className="label">Nombre del proyecto</label>
            <input
              className="field"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Curso de liderazgo para mandos medios"
              required
            />
          </div>
          <div>
            <label className="label">Audiencia</label>
            <input
              className="field"
              value={form.audience}
              onChange={(event) => setForm((prev) => ({ ...prev, audience: event.target.value }))}
              placeholder="Jefes de equipo con 1 a 3 años de experiencia"
              required
            />
          </div>
          <div>
            <label className="label">Nivel</label>
            <input
              className="field"
              value={form.level}
              onChange={(event) => setForm((prev) => ({ ...prev, level: event.target.value }))}
              placeholder="Intermedio"
              required
            />
          </div>
          <div>
            <label className="label">Duración total (horas)</label>
            <input
              className="field"
              type="number"
              min={1}
              step={1}
              value={form.durationHours}
              onChange={(event) => setForm((prev) => ({ ...prev, durationHours: Number(event.target.value) }))}
              required
            />
          </div>
          <div>
            <label className="label">Modalidad</label>
            <select
              className="field"
              value={form.modality}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, modality: event.target.value as FormState["modality"] }))
              }
            >
              <option value="virtual">Virtual</option>
              <option value="presencial">Presencial</option>
              <option value="blended">Blended</option>
            </select>
          </div>
          <div>
            <label className="label">Idioma</label>
            <input
              className="field"
              value={form.language}
              onChange={(event) => setForm((prev) => ({ ...prev, language: event.target.value }))}
            />
          </div>
          <div>
            <label className="label">Tono</label>
            <input
              className="field"
              value={form.tone}
              onChange={(event) => setForm((prev) => ({ ...prev, tone: event.target.value }))}
            />
          </div>
          <div>
            <label className="label">Modelo Gemini</label>
            <input
              className="field"
              value={form.model}
              onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
              placeholder="gemini-2.5-flash"
              required
            />
          </div>
          <div>
            <label className="label">Modo de seguridad</label>
            <select
              className="field"
              value={form.safetyMode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, safetyMode: event.target.value as FormState["safetyMode"] }))
              }
            >
              <option value="normal">Normal</option>
              <option value="estricto">Estricto</option>
            </select>
          </div>
          <div>
            <label className="label">Plantilla</label>
            <select
              className="field"
              value={form.template}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, template: event.target.value as FormState["template"] }))
              }
            >
              <option value="general">General</option>
              <option value="curso-corporativo">Curso corporativo</option>
              <option value="curso-academico">Curso académico</option>
              <option value="microlearning">Microlearning</option>
            </select>
          </div>
          <div>
            <label className="label">Modo de generación</label>
            <select
              className="field"
              value={form.mode}
              onChange={(event) => setForm((prev) => ({ ...prev, mode: event.target.value as FormState["mode"] }))}
            >
              <option value="full">Diseño completo</option>
              <option value="evaluation-only">Solo plan de evaluación</option>
              <option value="ova-storyboard">Storyboard de OVA</option>
            </select>
          </div>
        </div>
      </section>

      <section className="panel grid gap-4">
        <div>
          <label className="label">Objetivos generales</label>
          <textarea
            className="field min-h-[120px]"
            value={form.generalObjectives}
            onChange={(event) => setForm((prev) => ({ ...prev, generalObjectives: event.target.value }))}
            placeholder="Al finalizar, el participante podrá..."
            required
          />
        </div>
        <div>
          <label className="label">Restricciones</label>
          <textarea
            className="field min-h-[90px]"
            value={form.restrictions}
            onChange={(event) => setForm((prev) => ({ ...prev, restrictions: event.target.value }))}
            placeholder="Tiempo limitado, conectividad baja, política institucional..."
          />
        </div>
        <div>
          <label className="label">Recursos disponibles</label>
          <textarea
            className="field min-h-[90px]"
            value={form.availableResources}
            onChange={(event) => setForm((prev) => ({ ...prev, availableResources: event.target.value }))}
            placeholder="LMS Moodle, videoconferencia, repositorio documental..."
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label">Enfoque pedagógico</label>
            <textarea
              className="field min-h-[90px]"
              value={form.pedagogicalApproach}
              onChange={(event) => setForm((prev) => ({ ...prev, pedagogicalApproach: event.target.value }))}
              placeholder="Aprendizaje basado en problemas, flipped classroom..."
            />
          </div>
          <div>
            <label className="label">Enfoque de evaluación</label>
            <textarea
              className="field min-h-[90px]"
              value={form.evaluationApproach}
              onChange={(event) => setForm((prev) => ({ ...prev, evaluationApproach: event.target.value }))}
              placeholder="Formativa + sumativa con rúbricas analíticas..."
            />
          </div>
        </div>
      </section>

      {error ? <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={disabled}
          className="rounded-lg bg-accent px-4 py-2 font-medium text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Generando diseño en vivo..." : "Generar Diseño"}
        </button>
      </div>

      {(loading || liveProgress.length > 0 || liveSummary) && (
        <section className="panel">
          <h3 className="text-base font-semibold text-slate-900">Progreso en vivo</h3>
          {requestId ? (
            <p className="mt-1 text-xs text-slate-500">
              Request ID: <span className="font-mono">{requestId}</span>
            </p>
          ) : null}
          <ul className="mt-3 space-y-2">
            {liveProgress.map((item, index) => (
              <li key={`${item.stage}-${item.createdAt}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <p className="font-medium text-slate-900">{item.stage}</p>
                <p className="text-slate-700">{item.message}</p>
              </li>
            ))}
          </ul>

          {liveSummary && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
              <p>
                <span className="font-medium text-slate-900">Modelo:</span> {liveSummary.model}
              </p>
              <p>
                <span className="font-medium text-slate-900">Origen:</span>{" "}
                {liveSummary.fromCache ? "Caché" : "Generación nueva"}
              </p>
              <p>
                <span className="font-medium text-slate-900">Tokens (entrada/salida):</span> {liveSummary.tokenInput} /{" "}
                {liveSummary.tokenOutput}
              </p>
              <p>
                <span className="font-medium text-slate-900">Costo estimado:</span> $
                {liveSummary.estimatedCostUsd.toFixed(6)} USD
              </p>
            </div>
          )}
        </section>
      )}
    </form>
  );
}
