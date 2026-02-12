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
      return "Generar guion técnico instruccional (storyboard de OVA)";
    default:
      return "Diseño instruccional completo";
  }
}

function baseMaterialStrategyLabel(strategy: string): string {
  switch (strategy) {
    case "keep_all":
      return "Mantener todo el contenido del material base (sin omitir) y guionizarlo";
    case "analyze_storyboard":
      return "Analizar el material base y proponer un storyboard para abordar sus temáticas";
    default:
      return "Analizar el material base y proponer un storyboard";
  }
}

export function buildUserPrompt(request: GenerateRequest, previousJson?: unknown): string {
  if (request.requestType === "new") {
    const { project, options } = request;
    const baseMaterial =
      project.baseMaterial && project.baseMaterial.content
        ? `\n\nMaterial base provisto por el usuario (usar como insumo, no copiar literal si no aplica):\n- Archivo: ${project.baseMaterial.filename}\n- Tipo: ${project.baseMaterial.mimeType}\n- Contenido:\n<<<\n${project.baseMaterial.content}\n>>>\n\nRegla adicional:\n- Si el material base entra en conflicto con el brief, prioriza el brief y registra el conflicto en production_notes.risks.\n`
        : "";

    const strategy = project.baseMaterialStrategy ?? "analyze_storyboard";
    const strategyGuidance =
      strategy === "keep_all"
        ? `\nReglas adicionales por estrategia (keep_all):\n- Debes conservar TODO el contenido del material base (ideas, títulos, listas, numeraciones y ejemplos). No omitas nada.\n- Puedes resegmentar y reescribir para guionizar, pero cada fragmento del material debe estar representado en el storyboard.\n- Respeta el orden general del material base. Si reordenas por claridad, justifica el cambio en production_notes.risks.\n- No inventes contenido que no esté en el material base (salvo conectores mínimos, instrucciones de interacción y notas de producción).\n`
        : `\nReglas adicionales por estrategia (analyze_storyboard):\n- Analiza el material base, identifica temas y propone una secuencia didáctica (storyboard) clara y accionable.\n- Puedes reorganizar, agrupar y sintetizar; evita copiar literal si no es necesario.\n- No inventes datos, citas o fuentes. Si falta información, registra preguntas en production_notes.risks.\n`;

    return `Genera un diseño instruccional con estas entradas:
- Tipo de plantilla: ${templateLabel(options.template)}
- Modo: ${modeLabel(options.mode)}
- Curso: ${project.name}
- Recurso: ${project.resourceNumber} - ${project.resourceName}
- Estrategia de guionización con material base: ${baseMaterialStrategyLabel(strategy)}
- Formato sugerido para project.title: "${project.name} — Recurso ${project.resourceNumber}: ${project.resourceName}"
- Audiencia: ${project.audience}
- Nivel: ${project.level}
- Duración total en horas: ${project.durationHours}
- Modalidad: ${project.modality}
- Objetivos generales: ${project.generalObjectives || "No provistos (inferir desde el material base y el contexto del curso)"}
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
- Si el modo es "guion técnico instruccional", interpreta course_structure como una secuencia de escenas/pantallas del recurso y describe de forma accionable:
  - Narración / audio
  - Texto en pantalla
  - Interacción (si aplica)
  - Recursos multimedia sugeridos (placeholders)
  - Duración estimada por escena
${strategyGuidance}

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
