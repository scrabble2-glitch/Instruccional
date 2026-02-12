import { z } from "zod";

const RubricSchema = z
  .object({
    criterion: z.string().min(1),
    levels: z.array(z.string().min(1)).min(1)
  })
  .strict();

const AssessmentSchema = z
  .object({
    type: z.string().min(1),
    description: z.string().min(1),
    evidence: z.string().min(1),
    rubric: z.array(RubricSchema).min(1)
  })
  .strict();

const LearningActivitySchema = z
  .object({
    type: z.string().min(1),
    description: z.string().min(1),
    modality: z.string().min(1),
    estimated_minutes: z.number().int().positive()
  })
  .strict();

const ResourceSchema = z
  .object({
    type: z.string().min(1),
    title: z.string().min(1),
    link_optional: z.string()
  })
  .strict();

const CourseUnitSchema = z
  .object({
    unit_id: z.string().min(1),
    title: z.string().min(1),
    purpose: z.string().min(1),
    duration_minutes: z.number().int().positive(),
    outcomes: z.array(z.string().min(1)).min(1),
    content_outline: z.array(z.string().min(1)).min(1),
    learning_activities: z.array(LearningActivitySchema).min(1),
    assessment: z.array(AssessmentSchema).min(1),
    resources: z.array(ResourceSchema).min(1)
  })
  .strict();

const AlignmentMatrixRowSchema = z
  .object({
    outcome_id: z.string().min(1),
    activities: z.array(z.string().min(1)),
    assessments: z.array(z.string().min(1)),
    alignment_score_0_100: z.number().min(0).max(100),
    issues: z.array(z.string()),
    fix_suggestions: z.array(z.string())
  })
  .strict();

export const InstructionalDesignOutputSchema = z
  .object({
    project: z
      .object({
        title: z.string().min(1),
        audience: z.string().min(1),
        level: z.string().min(1),
        duration_hours: z.number().positive(),
        modality: z.string().min(1)
      })
      .strict(),
    instructional_model: z
      .object({
        approach: z.literal("ADDIE"),
        notes: z.string().min(1)
      })
      .strict(),
    learning_outcomes: z
      .array(
        z
          .object({
            id: z.string().min(1),
            statement: z.string().min(1),
            bloom_level: z.string().min(1)
          })
          .strict()
      )
      .min(1),
    course_structure: z.array(CourseUnitSchema).min(1),
    alignment_matrix: z.array(AlignmentMatrixRowSchema).min(1),
    production_notes: z
      .object({
        for_lms: z.array(z.string()),
        accessibility: z.array(z.string()),
        risks: z.array(z.string())
      })
      .strict()
  })
  .strict();

export type InstructionalDesignOutput = z.infer<typeof InstructionalDesignOutputSchema>;

export const outputSchemaForPrompt = `{
  "project": { "title": "string", "audience": "string", "level": "string", "duration_hours": 0, "modality": "string" },
  "instructional_model": { "approach": "ADDIE", "notes": "string" },
  "learning_outcomes": [{ "id": "LO1", "statement": "string", "bloom_level": "string" }],
  "course_structure": [{
    "unit_id": "U1",
    "title": "string",
    "purpose": "string",
    "duration_minutes": 0,
    "outcomes": ["LO1"],
    "content_outline": ["string"],
    "learning_activities": [{ "type": "string", "description": "string", "modality": "string", "estimated_minutes": 0 }],
    "assessment": [{ "type": "string", "description": "string", "evidence": "string", "rubric": [{ "criterion": "string", "levels": ["string"] }] }],
    "resources": [{ "type": "string", "title": "string", "link_optional": "string" }]
  }],
  "alignment_matrix": [{
    "outcome_id": "LO1",
    "activities": ["string"],
    "assessments": ["string"],
    "alignment_score_0_100": 0,
    "issues": ["string"],
    "fix_suggestions": ["string"]
  }],
  "production_notes": { "for_lms": ["string"], "accessibility": ["string"], "risks": ["string"] }
}`;

export const outputJsonSchema = {
  type: "object",
  properties: {
    project: {
      type: "object",
      properties: {
        title: { type: "string" },
        audience: { type: "string" },
        level: { type: "string" },
        duration_hours: { type: "number" },
        modality: { type: "string" }
      },
      required: ["title", "audience", "level", "duration_hours", "modality"]
    },
    instructional_model: {
      type: "object",
      properties: {
        approach: { type: "string", enum: ["ADDIE"] },
        notes: { type: "string" }
      },
      required: ["approach", "notes"]
    },
    learning_outcomes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          statement: { type: "string" },
          bloom_level: { type: "string" }
        },
        required: ["id", "statement", "bloom_level"]
      }
    },
    course_structure: {
      type: "array",
      items: {
        type: "object",
        properties: {
          unit_id: { type: "string" },
          title: { type: "string" },
          purpose: { type: "string" },
          duration_minutes: { type: "integer" },
          outcomes: { type: "array", items: { type: "string" } },
          content_outline: { type: "array", items: { type: "string" } },
          learning_activities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string" },
                description: { type: "string" },
                modality: { type: "string" },
                estimated_minutes: { type: "integer" }
              },
              required: ["type", "description", "modality", "estimated_minutes"]
            }
          },
          assessment: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string" },
                description: { type: "string" },
                evidence: { type: "string" },
                rubric: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      criterion: { type: "string" },
                      levels: { type: "array", items: { type: "string" } }
                    },
                    required: ["criterion", "levels"]
                  }
                }
              },
              required: ["type", "description", "evidence", "rubric"]
            }
          },
          resources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string" },
                title: { type: "string" },
                link_optional: { type: "string" }
              },
              required: ["type", "title", "link_optional"]
            }
          }
        },
        required: [
          "unit_id",
          "title",
          "purpose",
          "duration_minutes",
          "outcomes",
          "content_outline",
          "learning_activities",
          "assessment",
          "resources"
        ]
      }
    },
    alignment_matrix: {
      type: "array",
      items: {
        type: "object",
        properties: {
          outcome_id: { type: "string" },
          activities: { type: "array", items: { type: "string" } },
          assessments: { type: "array", items: { type: "string" } },
          alignment_score_0_100: { type: "number" },
          issues: { type: "array", items: { type: "string" } },
          fix_suggestions: { type: "array", items: { type: "string" } }
        },
        required: ["outcome_id", "activities", "assessments", "alignment_score_0_100", "issues", "fix_suggestions"]
      }
    },
    production_notes: {
      type: "object",
      properties: {
        for_lms: { type: "array", items: { type: "string" } },
        accessibility: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } }
      },
      required: ["for_lms", "accessibility", "risks"]
    }
  },
  required: [
    "project",
    "instructional_model",
    "learning_outcomes",
    "course_structure",
    "alignment_matrix",
    "production_notes"
  ]
} as const;
