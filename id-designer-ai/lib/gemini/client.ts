import { env, SafetyMode } from "@/lib/env";
import { outputJsonSchema } from "@/lib/validators/output-schema";

interface GeminiGenerateParams {
  model: string;
  systemInstruction: string;
  userPrompt: string;
  safetyMode: SafetyMode;
}

interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface GeminiGenerateResult {
  rawText: string;
  usage?: GeminiUsage;
}

function normalizeModelName(model: string): string {
  return model.toLowerCase().replace(/\s+/g, "").trim();
}

function isModelNotFound(status: number, text: string): boolean {
  if (status !== 404) return false;
  const normalized = text.toLowerCase();
  return normalized.includes("model") && (normalized.includes("not found") || normalized.includes("notfound"));
}

async function requestGemini(params: GeminiGenerateParams): Promise<Response> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent`;
  return fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      systemInstruction: {
        role: "system",
        parts: [{ text: params.systemInstruction }]
      },
      contents: [{ role: "user", parts: [{ text: params.userPrompt }] }],
      safetySettings: resolveSafetySettings(params.safetyMode),
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: outputJsonSchema
      }
    })
  });
}

function resolveSafetySettings(mode: SafetyMode): Array<Record<string, string>> {
  if (mode === "estricto") {
    return [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_LOW_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_LOW_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_LOW_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_LOW_AND_ABOVE" }
    ];
  }

  return [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
  ];
}

export async function callGeminiGenerateContent(
  params: GeminiGenerateParams
): Promise<GeminiGenerateResult> {
  if (!env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY no está configurada. Define la variable de entorno para habilitar generación con IA."
    );
  }

  const requestedModel = params.model.trim();
  let response = await requestGemini(params);
  let errorText = response.ok ? "" : await response.text().catch(() => "");

  // Fallback if Gemini 3 is not enabled in this account/project.
  if (!response.ok && isModelNotFound(response.status, errorText) && normalizeModelName(requestedModel).includes("gemini-3")) {
    response = await requestGemini({
      ...params,
      model: "gemini-2.5-pro"
    });
    errorText = response.ok ? "" : await response.text().catch(() => "");
  }

  if (!response.ok) {
    throw new Error(`Gemini error (${response.status}): ${errorText.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: GeminiUsage;
  };

  const rawText =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("\n")
      .trim() ?? "";

  if (!rawText) {
    throw new Error("Gemini respondió sin contenido de texto.");
  }

  return {
    rawText,
    usage: data.usageMetadata
  };
}

interface GeminiExtractParams {
  model: string;
  safetyMode: SafetyMode;
  instruction: string;
  mimeType: string;
  dataBase64: string;
}

async function requestGeminiExtractTextFromMedia(
  params: GeminiExtractParams,
  model: string
): Promise<Response> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  return fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: params.instruction },
            {
              inlineData: {
                mimeType: params.mimeType,
                data: params.dataBase64
              }
            }
          ]
        }
      ],
      safetySettings: resolveSafetySettings(params.safetyMode),
      generationConfig: {
        temperature: 0.0
      }
    })
  });
}

export async function callGeminiExtractTextFromMedia(params: GeminiExtractParams): Promise<GeminiGenerateResult> {
  if (!env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY no está configurada. Define la variable de entorno para extraer texto de documentos/imágenes."
    );
  }

  const requestedModel = params.model.trim();
  let response = await requestGeminiExtractTextFromMedia(params, requestedModel);
  let errorText = response.ok ? "" : await response.text().catch(() => "");

  // Fallback if Gemini 3 is not enabled in this account/project.
  if (!response.ok && isModelNotFound(response.status, errorText) && normalizeModelName(requestedModel).includes("gemini-3")) {
    response = await requestGeminiExtractTextFromMedia(params, "gemini-2.5-pro");
    errorText = response.ok ? "" : await response.text().catch(() => "");
  }

  if (!response.ok) {
    throw new Error(`Gemini error (${response.status}): ${errorText.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: GeminiUsage;
  };

  const rawText =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("\n")
      .trim() ?? "";

  if (!rawText) {
    throw new Error("Gemini respondió sin contenido de texto para la extracción.");
  }

  return {
    rawText,
    usage: data.usageMetadata
  };
}
