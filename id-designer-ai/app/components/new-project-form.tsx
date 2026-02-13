"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BASE_MATERIAL_MAX_BYTES, BASE_MATERIAL_MAX_CHARS } from "@/lib/constants/base-material";

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
  resourceNumber: string;
  resourceName: string;
  durationHours: number;
  baseMaterialFilename: string;
  baseMaterialMimeType: string;
  baseMaterialContent: string;
  baseMaterialStrategy: "keep_all" | "analyze_storyboard";
}

const DEFAULT_FORM: FormState = {
  name: "",
  resourceNumber: "",
  resourceName: "",
  durationHours: 8,
  baseMaterialFilename: "",
  baseMaterialMimeType: "",
  baseMaterialContent: "",
  baseMaterialStrategy: "analyze_storyboard",
};

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
    model_repair: "Reparación JSON",
    pptx_export: "Exportación PPTX",
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
  const [baseMaterialLoading, setBaseMaterialLoading] = useState(false);
  const [baseMaterialMeta, setBaseMaterialMeta] = useState<{ kind: string; truncated: boolean } | null>(null);
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

  const baseMaterialText = form.baseMaterialContent.trim();
  const keepAll = form.baseMaterialStrategy === "keep_all";
  const keepAllWouldOmit = keepAll
    ? baseMaterialMeta
      ? baseMaterialMeta.truncated
      : form.baseMaterialContent.length >= BASE_MATERIAL_MAX_CHARS
    : false;

  const disabled = useMemo(
    () =>
      loading ||
      baseMaterialLoading ||
      !baseMaterialText ||
      keepAllWouldOmit ||
      !form.name.trim() ||
      !form.resourceNumber.trim() ||
      !form.resourceName.trim(),
    [baseMaterialLoading, baseMaterialText, form, keepAllWouldOmit, loading]
  );

  function clearBaseMaterial() {
    setForm((prev) => ({
      ...prev,
      baseMaterialFilename: "",
      baseMaterialMimeType: "",
      baseMaterialContent: ""
    }));
    setBaseMaterialMeta(null);
  }

  async function onBaseFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Allow picking the same file twice by clearing the input.
    event.target.value = "";

    if (!file) {
      return;
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const allowedTextExtensions = new Set(["txt", "md", "markdown", "json", "csv", "rtf", "html", "htm"]);
    const allowedTextMimeTypes = new Set(["text/plain", "text/markdown", "application/json", "text/csv", "application/rtf"]);

    const allowedBinaryExtensions = new Set(["pdf", "docx", "pptx", "png", "jpg", "jpeg", "webp", "gif"]);
    const allowedBinaryMimeTypes = new Set([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif"
    ]);

    const isTextLike =
      (file.type && (file.type.startsWith("text/") || allowedTextMimeTypes.has(file.type))) || allowedTextExtensions.has(ext);

    const isBinarySupported =
      (file.type && (allowedBinaryMimeTypes.has(file.type) || file.type.startsWith("image/"))) ||
      allowedBinaryExtensions.has(ext);

    if (!isTextLike && !isBinarySupported) {
      setError("Formato no soportado. Usa PDF, DOCX, PPTX, texto (.txt/.md/.json) o imágenes (PNG/JPG/WEBP).");
      return;
    }

    if (file.size > BASE_MATERIAL_MAX_BYTES) {
      setError(`Archivo demasiado grande. Máximo ${Math.round(BASE_MATERIAL_MAX_BYTES / 1000)} KB.`);
      return;
    }

    setError(null);
    setBaseMaterialLoading(true);
    setBaseMaterialMeta(null);

    try {
      if (isTextLike) {
        const text = await file.text();
        if (text.length > BASE_MATERIAL_MAX_CHARS) {
          setError(`Contenido demasiado largo. Máximo ${BASE_MATERIAL_MAX_CHARS} caracteres.`);
          return;
        }

        setForm((prev) => ({
          ...prev,
          baseMaterialFilename: file.name,
          baseMaterialMimeType: file.type || "text/plain",
          baseMaterialContent: text
        }));
        setBaseMaterialMeta({ kind: "text", truncated: false });
        return;
      }

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/material/extract", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        // Para NotebookLM esto no es crítico: el usuario puede subir el archivo directamente a NotebookLM.
        setError(payload?.error ?? "No fue posible extraer contenido del archivo.");
        return;
      }

      const payload = (await response.json()) as {
        filename: string;
        mimeType: string;
        content: string;
        truncated: boolean;
        kind: string;
      };

      setForm((prev) => ({
        ...prev,
        baseMaterialFilename: payload.filename || file.name,
        baseMaterialMimeType: payload.mimeType || file.type || "application/octet-stream",
        baseMaterialContent: payload.content || ""
      }));
      setBaseMaterialMeta({ kind: payload.kind, truncated: Boolean(payload.truncated) });
    } catch {
      setError("Error de red al procesar el archivo base.");
    } finally {
      setBaseMaterialLoading(false);
    }
  }

  async function downloadPptx(versionId: string): Promise<boolean> {
    try {
      const response = await fetch(`/api/versions/${versionId}/export?format=pptx`, { method: "GET" });
      if (!response.ok) {
        return false;
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = /filename=\"?([^\";]+)\"?/i.exec(disposition);
      const filename = match?.[1] ?? `guion-${versionId}.pptx`;

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      return true;
    } catch {
      return false;
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!baseMaterialText) {
      setError("Agrega un archivo base o pega el contenido antes de generar el guion.");
      return;
    }

    if (keepAllWouldOmit) {
      setError(
        "La estrategia 'mantener todo el contenido' requiere que el material base no esté truncado. " +
          "Divide el archivo en partes más pequeñas o reduce el contenido hasta que quepa completo."
      );
      return;
    }

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

    const baseMaterialContent = form.baseMaterialContent.trim();
    const baseMaterial =
      baseMaterialContent.length > 0
        ? {
            filename: form.baseMaterialFilename || "material-base.txt",
            mimeType: form.baseMaterialMimeType || "text/plain",
            content: form.baseMaterialContent
          }
        : undefined;

    const payload = {
      requestType: "new",
      project: {
        name: form.name,
        resourceNumber: form.resourceNumber,
        resourceName: form.resourceName,
        baseMaterialStrategy: form.baseMaterialStrategy,
        durationHours: Number(form.durationHours),
        baseMaterial
      },
      options: {
        mode: "ova-storyboard"
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
                : "No fue posible generar el guion técnico instruccional en modo en vivo.";
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
              versionId: string;
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
                message: "Generación finalizada. Preparando presentación PPTX...",
                createdAt: Date.now()
              }
            ]);

            setLiveProgress((prev) => [
              ...prev,
              {
                stage: toStageLabel("pptx_export"),
                message: "Generando PPTX para descarga automática...",
                createdAt: Date.now()
              }
            ]);

            const pptxOk = await downloadPptx(data.versionId);
            if (!pptxOk) {
              setLiveProgress((prev) => [
                ...prev,
                {
                  stage: toStageLabel("pptx_export"),
                  message: "No se pudo descargar el PPTX automáticamente. Podrás exportarlo desde el resultado.",
                  createdAt: Date.now()
                }
              ]);
            }

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
      setError("Error de red al generar el guion técnico instruccional.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <section className="panel">
        <h2 className="text-lg font-semibold text-slate-900">Guion técnico instruccional</h2>
        <p className="mt-1 text-sm text-slate-600">
          Ingresa los datos mínimos del curso y del recurso. El sistema generará un guion técnico (storyboard) alineado a
          ADDIE + alineación constructiva.
        </p>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="label">Nombre del curso</label>
            <input
              className="field"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Curso de liderazgo para mandos medios"
              required
            />
          </div>
          <div>
            <label className="label">Número de recurso</label>
            <input
              className="field"
              value={form.resourceNumber}
              onChange={(event) => setForm((prev) => ({ ...prev, resourceNumber: event.target.value }))}
              placeholder="R01"
              required
            />
          </div>
          <div>
            <label className="label">Nombre del recurso</label>
            <input
              className="field"
              value={form.resourceName}
              onChange={(event) => setForm((prev) => ({ ...prev, resourceName: event.target.value }))}
              placeholder="Introducción y objetivos"
              required
            />
          </div>
          <div>
            <label className="label">Duración (horas)</label>
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
        </div>
      </section>

      <section className="panel grid gap-4">
        <div>
          <label className="label">Archivo base</label>
          <div className="mt-1 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor="base-material-file"
                className="cursor-pointer rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-100"
              >
                {baseMaterialLoading ? "Procesando..." : "Seleccionar archivo"}
              </label>
              <input
                id="base-material-file"
                type="file"
                accept=".txt,.md,.markdown,.json,.csv,.rtf,.html,.htm,.pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,.gif,text/plain,text/markdown,application/json,text/csv,application/rtf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/*"
                className="hidden"
                onChange={onBaseFileSelected}
              />
              {form.baseMaterialContent ? (
                <button
                  type="button"
                  onClick={clearBaseMaterial}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  Quitar
                </button>
              ) : null}
            </div>

            <p className="mt-2 text-xs text-slate-600">
              Formatos soportados: <span className="font-mono">.txt</span>, <span className="font-mono">.md</span>,{" "}
              <span className="font-mono">.json</span>, <span className="font-mono">.pdf</span>,{" "}
              <span className="font-mono">.docx</span>, <span className="font-mono">.pptx</span>,{" "}
              imágenes (<span className="font-mono">.png</span>, <span className="font-mono">.jpg</span>,{" "}
              <span className="font-mono">.webp</span>). Máximo {Math.round(BASE_MATERIAL_MAX_BYTES / 1000)} KB y{" "}
              {BASE_MATERIAL_MAX_CHARS.toLocaleString("es-ES")} caracteres.
            </p>

            {form.baseMaterialFilename ? (
              <p className="mt-2 text-xs text-slate-700">
                Archivo cargado: <span className="font-mono">{form.baseMaterialFilename}</span>
              </p>
            ) : null}

            {baseMaterialMeta ? (
              <p className="mt-1 text-xs text-slate-600">
                Tipo detectado: <span className="font-mono">{baseMaterialMeta.kind}</span>
                {baseMaterialMeta.truncated ? " (contenido truncado)" : ""}
              </p>
            ) : null}
          </div>
        </div>

        <div>
          <label className="label">Estrategia de guionización</label>
          <div className="mt-1 grid gap-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <input
                type="radio"
                name="baseMaterialStrategy"
                value="keep_all"
                checked={form.baseMaterialStrategy === "keep_all"}
                onChange={() => setForm((prev) => ({ ...prev, baseMaterialStrategy: "keep_all" }))}
                className="mt-0.5"
              />
              <div>
                <p className="font-medium text-slate-900">1) Mantener todo el contenido y guionizar</p>
                <p className="mt-1 text-xs text-slate-600">
                  No se omite nada del material base. Se guioniza sección por sección y se respeta el orden general.
                </p>
              </div>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <input
                type="radio"
                name="baseMaterialStrategy"
                value="analyze_storyboard"
                checked={form.baseMaterialStrategy === "analyze_storyboard"}
                onChange={() => setForm((prev) => ({ ...prev, baseMaterialStrategy: "analyze_storyboard" }))}
                className="mt-0.5"
              />
              <div>
                <p className="font-medium text-slate-900">2) Analizar y proponer storyboard</p>
                <p className="mt-1 text-xs text-slate-600">
                  Se analiza el material base y se propone una secuencia didáctica clara. Puede reorganizar, agrupar y
                  sintetizar.
                </p>
              </div>
            </label>
          </div>

          {keepAllWouldOmit ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Aviso: el contenido actual parece estar truncado. Para la opción 1, divide el documento en partes más
              pequeñas o reduce el contenido.
            </p>
          ) : null}
        </div>

        <div>
          <label className="label">Contenido del material base (editable)</label>
          <textarea
            className="field min-h-[140px]"
            value={form.baseMaterialContent}
            onChange={(event) => {
              const next = event.target.value.slice(0, BASE_MATERIAL_MAX_CHARS);
              setBaseMaterialMeta(null);
              setForm((prev) => ({
                ...prev,
                baseMaterialFilename: prev.baseMaterialFilename || "material-base.txt",
                baseMaterialMimeType: prev.baseMaterialMimeType || "text/plain",
                baseMaterialContent: next
              }));
            }}
            placeholder="Pega aquí contenido, un guion previo, temario o lineamientos del recurso. Se usará como contexto para la IA."
          />
          <p className="mt-1 text-xs text-slate-500">
            {form.baseMaterialContent.length.toLocaleString("es-ES")} /{" "}
            {BASE_MATERIAL_MAX_CHARS.toLocaleString("es-ES")} caracteres
          </p>
        </div>
      </section>

      {error ? <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={disabled}
          className="rounded-lg bg-accent px-4 py-2 font-medium text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Generando guion en vivo..." : "Generar guion técnico instruccional"}
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
