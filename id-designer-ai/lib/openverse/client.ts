export interface OpenverseImageCandidate {
  id: string;
  title: string;
  pageUrl: string | null;
  imageUrl: string;
  creator?: string;
  license?: string;
  licenseUrl?: string;
  provider?: string;
  licenseRisk?: "low" | "review";
  licensePolicyNote?: string;
}

const OPENVERSE_BASE_URL = "https://api.openverse.engineering/v1/images/";

function classifyLicense(licenseRaw: string): { risk: "low" | "review"; note: string; score: number } {
  const license = (licenseRaw ?? "").toLowerCase().trim();
  if (!license) {
    return {
      risk: "review",
      note: "Licencia no informada: requiere validación manual antes de uso final.",
      score: -25
    };
  }

  if (license === "cc0" || license.includes("pdm")) {
    return { risk: "low", note: "Licencia abierta/permisiva.", score: 32 };
  }

  if (license.includes("by-sa") || license.includes("by")) {
    return { risk: "low", note: "Licencia permisiva con atribución obligatoria.", score: 14 };
  }

  if (license.includes("nc")) {
    return {
      risk: "review",
      note: "Licencia con restricción no comercial: validar alcance de uso.",
      score: -18
    };
  }

  if (license.includes("nd")) {
    return {
      risk: "review",
      note: "Licencia sin obras derivadas: puede limitar edición/adaptación.",
      score: -22
    };
  }

  return {
    risk: "review",
    note: "Licencia no estándar: requiere revisión editorial/legal.",
    score: -12
  };
}

function scoreResult(result: any, preferHorizontal: boolean): number {
  const url = String(result?.url ?? "");
  if (!url.startsWith("http")) return -999;

  const width = Number(result?.width ?? 0);
  const height = Number(result?.height ?? 0);
  const isHorizontal = width > 0 && height > 0 ? width >= height : true;

  const license = String(result?.license ?? "").toLowerCase();
  const provider = String(result?.provider ?? "").toLowerCase();

  let score = 0;
  if (preferHorizontal && isHorizontal) score += 20;
  if (!preferHorizontal && !isHorizontal) score += 10;

  // Prefer larger visuals when available.
  if (width > 0 && height > 0) {
    const area = width * height;
    score += Math.min(50, Math.round(area / 200_000)); // soft cap
  }

  // Prefer permissive licenses for dev previews.
  const licensePolicy = classifyLicense(license);
  score += licensePolicy.score;

  if (provider.includes("wikimedia")) score += 5;
  if (provider.includes("flickr")) score += 2;

  return score;
}

export async function searchOpenverseImage(params: {
  term: string;
  preferHorizontal?: boolean;
  pageSize?: number;
}): Promise<OpenverseImageCandidate | null> {
  const term = params.term.trim();
  if (!term) return null;

  const qs = new URLSearchParams({
    q: term,
    page_size: String(params.pageSize ?? 20)
  });

  const url = `${OPENVERSE_BASE_URL}?${qs.toString()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Openverse API error (status ${response.status}). ${text.slice(0, 500)}`);
  }

  const json: any = await response.json();
  const results: any[] = Array.isArray(json?.results) ? json.results : [];
  if (!results.length) return null;

  const preferHorizontal = params.preferHorizontal ?? true;
  const ranked = results
    .map((result) => ({ result, score: scoreResult(result, preferHorizontal) }))
    .filter((entry) => entry.score > -100)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.result;
  if (!best) return null;

  const imageUrl = String(best?.url ?? "");
  if (!imageUrl) return null;

  const pageUrl =
    typeof best?.foreign_landing_url === "string"
      ? best.foreign_landing_url
      : typeof best?.detail_url === "string"
        ? best.detail_url
        : null;

  const licenseUrl = typeof best?.license_url === "string" ? best.license_url : undefined;
  const license = typeof best?.license === "string" ? best.license : undefined;
  const licensePolicy = classifyLicense(license ?? "");

  return {
    id: String(best?.id ?? "unknown"),
    title: String(best?.title ?? "Imagen"),
    pageUrl,
    imageUrl,
    creator: typeof best?.creator === "string" ? best.creator : undefined,
    license,
    licenseUrl,
    provider: typeof best?.provider === "string" ? best.provider : undefined,
    licenseRisk: licensePolicy.risk,
    licensePolicyNote: licensePolicy.note
  };
}
