import type { InstructionalDesignOutput } from "@/lib/validators/output-schema";

export const sampleOutput: InstructionalDesignOutput = {
  project: {
    title: "Curso de liderazgo",
    audience: "Mandos medios",
    level: "Intermedio",
    duration_hours: 8,
    modality: "virtual"
  },
  instructional_model: {
    approach: "ADDIE",
    notes: "Secuencia orientada a desempeño con práctica guiada."
  },
  learning_outcomes: [
    {
      id: "LO1",
      statement: "Aplicar técnicas de feedback efectivo en reuniones 1:1.",
      bloom_level: "Aplicar"
    }
  ],
  course_structure: [
    {
      unit_id: "U1",
      title: "Fundamentos de liderazgo",
      purpose: "Establecer bases conceptuales y casos de uso.",
      duration_minutes: 120,
      outcomes: ["LO1"],
      content_outline: ["Roles del líder", "Errores comunes en feedback"],
      learning_activities: [
        {
          type: "Taller",
          description: "Role play de conversación de feedback",
          modality: "virtual",
          estimated_minutes: 40
        }
      ],
      assessment: [
        {
          type: "Rúbrica analítica",
          description: "Evaluación de role play",
          evidence: "Grabación o guion de conversación",
          rubric: [
            {
              criterion: "Claridad",
              levels: ["Inicial", "En desarrollo", "Logrado"]
            }
          ]
        }
      ],
      resources: [
        {
          type: "video",
          title: "Video corto explicativo",
          link_optional: "placeholder://video-feedback"
        }
      ]
    }
  ],
  alignment_matrix: [
    {
      outcome_id: "LO1",
      activities: ["Role play de feedback"],
      assessments: ["Rúbrica analítica del role play"],
      alignment_score_0_100: 88,
      issues: [],
      fix_suggestions: []
    }
  ],
  production_notes: {
    for_lms: ["Cargar recurso U1 en formato MP4 y guía PDF."],
    accessibility: ["Incluir subtítulos y transcripción."],
    risks: ["Confirmar disponibilidad de tutores sincrónicos."]
  }
};
