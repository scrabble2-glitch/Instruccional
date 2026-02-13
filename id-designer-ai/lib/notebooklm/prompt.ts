type BaseMaterialStrategy = "keep_all" | "analyze_storyboard";

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function strategyLabel(strategy: BaseMaterialStrategy): string {
  return strategy === "keep_all"
    ? "Mantener todo el contenido (sin omitir) y guionizarlo"
    : "Analizar el material base y proponer un storyboard didáctico";
}

export function buildNotebookLmPrompt(params: {
  courseName: string;
  resourceNumber: string;
  resourceName: string;
  durationHours: number;
  strategy: BaseMaterialStrategy;
}): string {
  const courseName = compact(params.courseName);
  const resourceNumber = compact(params.resourceNumber);
  const resourceName = compact(params.resourceName);
  const durationHours = Number.isFinite(params.durationHours) ? Math.max(1, Math.round(params.durationHours)) : 1;

  if (params.strategy === "keep_all") {
    return `Actúa como experto en Guion Técnico Instruccional profesional (ADDIE + alineación constructiva).

Reglas duras:
- Usa SOLO la información de los documentos fuente del Notebook. No inventes datos, enlaces, cifras ni definiciones externas.
- NO omitas nada del contenido del material base: cada sección/encabezado/tema debe quedar representado.
- Respeta el orden general del material. Si reordenas por claridad, indícalo en “Riesgos/Preguntas”.
- Escribe en español neutro, tono profesional.

Entradas del brief:
- Curso: ${courseName}
- Recurso: ${resourceNumber} — ${resourceName}
- Duración total: ${durationHours} horas
- Estrategia: ${strategyLabel(params.strategy)}

Tarea:
1) Genera un “Mapa de cobertura” con todas las secciones/encabezados del material base (lista numerada).
2) Guioniza TODO en una tabla Markdown con columnas:
   - Sección origen
   - Escena/Pantalla (ID)
   - Objetivo didáctico (verbo + Bloom)
   - Texto en pantalla
   - Narración/locución
   - Interacción/actividad
   - Recursos multimedia (placeholders, sin links)
   - Accesibilidad (subtítulos/alt/contraste/lectura fácil)
   - Tiempo estimado (min)
3) Al final incluye:
   - Total de minutos y verificación vs ${durationHours} horas (ajusta TIEMPOS sin borrar contenido)
   - Checklist de calidad (alineación objetivo↔actividad↔evidencia, coherencia, carga cognitiva)
   - Riesgos/Preguntas (preguntas concretas si falta información).`;
  }

  return `Actúa como experto en Guion Técnico Instruccional profesional (ADDIE + alineación constructiva).

Reglas duras:
- Usa SOLO la información de los documentos fuente del Notebook. No inventes datos, enlaces, cifras ni definiciones externas.
- Puedes reorganizar, agrupar y sintetizar, pero NO cambies el significado ni agregues temas fuera del material.
- Escribe en español neutro, tono profesional.

Entradas del brief:
- Curso: ${courseName}
- Recurso: ${resourceNumber} — ${resourceName}
- Duración total: ${durationHours} horas
- Estrategia: ${strategyLabel(params.strategy)}

Tarea:
1) Identifica temáticas del material base y propón un storyboard didáctico (secuencia clara).
2) Define 5–10 resultados de aprendizaje (Bloom) y asegúrate de que el storyboard los cubra.
3) Entrega una tabla Markdown con columnas:
   - Escena/Pantalla (ID)
   - Propósito
   - Resultado(s) (IDs)
   - Contenido clave (bullets)
   - Texto en pantalla
   - Narración/locución
   - Interacción/actividad práctica
   - Evidencia/evaluación breve
   - Recursos multimedia (placeholders, sin links)
   - Accesibilidad
   - Tiempo estimado (min)
4) Al final incluye:
   - Matriz rápida de alineación (resultado → escenas → evidencia) con observaciones
   - Total de minutos vs ${durationHours} horas
   - Riesgos/Preguntas (preguntas concretas si falta información).`;
}

