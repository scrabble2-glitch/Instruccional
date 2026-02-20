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
- Si el material base es muy extenso, confuso o contradictorio, agrega en production_notes.risks un item que empiece por:
  - "NOTEBOOKLM:" seguido de un prompt corto + 3-5 preguntas guía para analizar el material en NotebookLM (solo sugerencia; no intentes usar NotebookLM directamente).
- Si el modo es "guion técnico instruccional (storyboard de OVA)":
  - Interpreta course_structure como una secuencia de pantallas/escenas. Cada item representa 1 pantalla (o 1 pantalla por parte si es muy extensa).
  - La presentación debe quedar lista para producción: texto en pantalla + interactividad + guion de audio + notas de construcción.
  - Organiza cada pantalla con criterio profesional:
    - 45-60% del área para contenido textual del estudiante.
    - 40-55% para visuales (imagen, íconos, infografía o actividad).
    - Evita bloques largos: máximo 6 bullets, frases cortas y jerarquía visual clara.
  - Usa estos campos por pantalla:
    - content_outline: SOLO texto visible para estudiantes (títulos, bullets, mensajes, copy). No incluyas aquí notas de construcción.
      Reglas de estilo: máximo 6 bullets; evita párrafos largos; si el material base es extenso, divide en pantallas consecutivas.
      Debe incluir explícitamente una sección breve "Interacción del estudiante" (1-3 bullets accionables).
    - learning_activities: describe la interactividad como instrucciones para estudiantes (qué hacer y qué ocurre: botones, check de navegación, pop-ups, drag and drop, preguntas, feedback).
    - assessment: usa para checks de aprendizaje (preguntas, ejercicios evaluables) con evidencia y rúbrica simple.
    - resources: incluye placeholders de recursos multimedia (iconos/imagenes/infografías/video). NO inventes links reales.
      Además, agrega obligatoriamente 6 recursos especiales por pantalla (sin links reales):
      1) { type: "guion_audio", title: "<guion completo de narración para esa pantalla>", link_optional: "" }
      2) { type: "notas_construccion", title: "<instrucciones de construcción (capas, botones, estados, triggers, navegación) + textos emergentes si aplica>", link_optional: "" }
      3) { type: "imagen_query", title: "<término de búsqueda para banco de imágenes (3-8 palabras) + estilo visual sugerido (ej. 'ilustración plana', 'foto realista', 'vector estilo freepik')>", link_optional: "" }
      4) { type: "icon_query", title: "<búsqueda de íconos para la pantalla (3-6 palabras) + estilo de iconografía>", link_optional: "" }
      5) { type: "visual_spec", title: "<especificación visual de la infografía y componentes UI en formato texto>", link_optional: "" }
      6) { type: "infografia_tecnica", title: "<especificación técnica de infografía (estructura de datos, metáfora visual, mermaid, paleta y estilo)>", link_optional: "" }

      Formato requerido para "visual_spec" (texto, NO JSON), ejemplo:
      layout: process_steps
      visual_mode: infographic
      items:
      - Paso 1 | Título corto | Texto muy breve (<= 120 caracteres)
      - Paso 2 | Título corto | Texto muy breve
      - Paso 3 | Título corto | Texto muy breve
      buttons: Ver ejemplo, Tip
      popups:
      - Ver ejemplo | Ejemplo | Texto emergente breve (<= 220 caracteres)
      - Tip | Recomendación | Texto emergente breve

      Reglas "visual_spec":
      - layout permitido: process_steps | cards | timeline | bullets
      - visual_mode permitido: auto | infographic | image_support | comparison | activity
      - items: 2 a 5 elementos (título y texto breve). Deben corresponder al contenido de la pantalla.
      - buttons: 0 a 4 botones (labels) visibles en pantalla (hotspots).
      - popups: si defines buttons, define también popups (1 por botón) con el texto emergente que verá el estudiante.
      - No incluyas links.
      - Piensa en estilo "Genially": poco texto, jerarquía visual, tarjetas, íconos, y acciones claras (botones + popups).
      - Incluye al menos un componente visual principal por pantalla (imagen de apoyo, comparación, actividad visual o infografía), no solo texto.
      - Las indicaciones técnicas para diseñador NO van en content_outline: deben ir en notas_construccion.
      - NO uses solo infografías para todo. Elige visual_mode según tema y extensión:
        - image_support: temas introductorios o narrativos
        - comparison: cuando hay contraste/diferencias/ventajas
        - activity: cuando predomina instrucción de práctica
        - infographic: solo cuando el tema realmente requiere esquema visual estructurado

      Formato requerido para "infografia_tecnica" (texto, NO JSON):
      tema: <tema que amerita representación gráfica>
      requiere_infografia: si|no
      estructura_datos:
      - Nivel 1 > Nivel 2 > Concepto clave
      - ...
      metafora_visual: <metáfora sugerida: engranaje, montaña, ruta, etc.>
      codigo_mermaid: <código Mermaid en texto plano, sin backticks. Ej: flowchart LR; A["Nodo 1"] --> B["Nodo 2"]>
      paleta_colores:
      - #0B7285
      - #0EA5E9
      - #F8FAFC
      estilo_iconografia: <flat|lineal|duotono|3D suave>

      Reglas "infografia_tecnica":
      - Para la pantalla que determine que necesita gráfica, marca requiere_infografia: si.
      - Para pantallas que NO requieren gráfica estructurada, marca requiere_infografia: no.
      - Entrega código Mermaid legible y profesional (nodos con textos cortos y claros).
      - Si no aplica infografía, puedes dejar codigo_mermaid en una línea simple (ej: flowchart LR; A["No aplica"]).
      - No incluyas enlaces externos ni menciones APIs.
      - Si el tema es ambiguo, agrega en production_notes.risks una sugerencia que inicie con "NOTEBOOKLM:" para análisis complementario.
  - El guion de audio debe ser natural, profesional y coherente con el texto en pantalla.
  - En keep_all: no omitas contenido; distribúyelo en pantallas sin perder el orden general.
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

export function buildStoryboardCompletionPrompt(previousJson: unknown, issues: string[]): string {
  const issuesText = issues.length ? issues.map((issue) => `- ${issue}`).join("\n") : "- (Sin issues)";
  return `Completa el siguiente JSON (ya válido) para que el storyboard de OVA quede listo para producción.

Objetivo:
- Asegurar que cada pantalla incluya guion de audio y notas de construcción, según el estándar descrito.
- No cambies el contenido pedagógico existente salvo lo estrictamente necesario para completar los campos faltantes.

Reglas:
1) Devuelve solo JSON válido, sin texto adicional.
2) Mantén exactamente el mismo schema.
3) Para cada item en course_structure, asegúrate de incluir recursos especiales:
   - { type: "guion_audio", title: "<guion completo de narración para esa pantalla>", link_optional: "" }
   - { type: "notas_construccion", title: "<instrucciones de construcción + textos emergentes si aplica>", link_optional: "" }
4) Además, incluye un recurso:
   - { type: "imagen_query", title: "<término de búsqueda para banco de imágenes (3-8 palabras) + estilo visual>", link_optional: "" }
5) Además, incluye un recurso:
   - { type: "icon_query", title: "<búsqueda de íconos (3-6 palabras) + estilo de iconografía>", link_optional: "" }
6) Además, incluye un recurso:
   - { type: "visual_spec", title: "<layout + visual_mode + items + buttons + popups (formato texto; NO JSON)>", link_optional: "" }
   - Si defines buttons en visual_spec, define popups (1 por botón) con el texto emergente.
7) Además, incluye un recurso:
   - { type: "infografia_tecnica", title: "<tema + requiere_infografia + estructura_datos + metafora_visual + codigo_mermaid + paleta_colores + estilo_iconografia>", link_optional: "" }
8) No inventes links reales.
9) Formato mínimo de infografia_tecnica (texto):
   tema: ...
   requiere_infografia: si|no
   estructura_datos:
   - ...
   metafora_visual: ...
   codigo_mermaid: flowchart LR; A["..."] --> B["..."]
   paleta_colores:
   - #0B7285
   - #0EA5E9
   estilo_iconografia: flat|lineal|duotono|3D suave

Issues detectados:
${issuesText}

JSON a completar:
${JSON.stringify(previousJson, null, 2)}`;
}

export function buildRepairPrompt(rawResponse: string, errorsSummary: string): string {
  return `Corrige el siguiente contenido para que sea JSON válido y cumpla exactamente el schema solicitado.
No agregues explicaciones.

Errores detectados:
${errorsSummary}

Contenido a reparar:
${rawResponse}`;
}
