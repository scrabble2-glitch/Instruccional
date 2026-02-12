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

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent`;

  const response = await fetch(endpoint, {
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

  if (!response.ok) {
    const errorText = await response.text();
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
