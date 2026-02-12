import { GenerateRequest } from "@/lib/validators/input";
import { outputSchemaForPrompt } from "@/lib/validators/output-schema";

function templateLabel(template: string): string {
  switch (template) {
    case "curso-corporativo":
      return "Curso corporativo orientado a desempeño en puesto";
    case "curso-academico":
      return "Curso académico con rigor disciplinar";
    case "microlearning":
      return "Microlearning modular de alta aplicabilidad";
    default:
      return "Diseño instruccional general";
  }
}

function modeLabel(mode: string): string {
  switch (mode) {
    case "evaluation-only":
      return "Generar solo plan de evaluación";
    case "ova-storyboard":
      return "Generar storyboard de OVA";
    default:
      return "Diseño instruccional completo";
  }
}

export function buildUserPrompt(request: GenerateRequest, previousJson?: unknown): string {
  if (request.requestType === "new") {
    const { project, options } = request;
    const baseMaterial =
      project.baseMaterial && project.baseMaterial.content
        ? `\n\nMaterial base provisto por el usuario (usar como insumo, no copiar literal si no aplica):\n- Archivo: ${project.baseMaterial.filename}\n- Tipo: ${project.baseMaterial.mimeType}\n- Contenido:\n<<<\n${project.baseMaterial.content}\n>>>\n\nRegla adicional:\n- Si el material base entra en conflicto con el brief, prioriza el brief y registra el conflicto en production_notes.risks.\n`
        : "";

    return `Genera un diseño instruccional con estas entradas:
- Tipo de plantilla: ${templateLabel(options.template)}
- Modo: ${modeLabel(options.mode)}
- Título: ${project.name}
- Audiencia: ${project.audience}
- Nivel: ${project.level}
- Duración total en horas: ${project.durationHours}
- Modalidad: ${project.modality}
- Objetivos generales: ${project.generalObjectives}
- Restricciones: ${project.restrictions ?? "Sin restricciones declaradas"}
- Recursos disponibles: ${project.availableResources ?? "No especificados"}
- Enfoque pedagógico: ${project.pedagogicalApproach ?? "No especificado"}
- Enfoque de evaluación: ${project.evaluationApproach ?? "No especificado"}
- Idioma: ${project.language}
- Tono: ${project.tone}
${baseMaterial}

Instrucciones de guardrail:
- Si falta información crítica, formula preguntas concretas en production_notes.risks.
- Evita alucinaciones: no cites fuentes específicas ni datos no verificables.
- Para recursos externos, usa descripciones genéricas y placeholders.

Devuelve JSON estricto con este schema exacto:
${outputSchemaForPrompt}`;
  }

  return `Toma este diseño instruccional base y aplica un ajuste puntual.

Sección objetivo para modificar: ${request.targetSection}
Instrucción de edición: ${request.editInstruction}

JSON base actual:
${JSON.stringify(previousJson, null, 2)}

Reglas:
1) Conserva todo lo no afectado por la instrucción.
2) Modifica solo lo necesario en la sección objetivo (o global si targetSection=all).
3) Mantén coherencia de IDs, trazabilidad outcome-actividad-evaluación y tiempos realistas.
4) Si la instrucción tiene ambigüedades, asume lo mínimo y registra preguntas en production_notes.risks.
5) Devuelve solo JSON válido con el schema exacto, sin texto adicional.

Schema:
${outputSchemaForPrompt}`;
}

export function buildRepairPrompt(rawResponse: string, errorsSummary: string): string {
  return `Corrige el siguiente contenido para que sea JSON válido y cumpla exactamente el schema solicitado.
No agregues explicaciones.

Errores detectados:
${errorsSummary}

Contenido a reparar:
${rawResponse}`;
}
