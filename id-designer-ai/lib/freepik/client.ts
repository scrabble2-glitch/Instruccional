import { env } from "@/lib/env";

export interface FreepikImageCandidate {
  id: number | string;
  title: string;
  pageUrl: string | null;
  imageUrl: string;
  authorName?: string;
  licenseUrl?: string;
}

function hasFreepikKey(): boolean {
  return Boolean(env.FREEPIK_API_KEY && env.FREEPIK_API_KEY.trim().length > 0);
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/g, "");
  const trimmedPath = path.replace(/^\/+/g, "");
  return `${trimmedBase}/${trimmedPath}`;
}

function scoreResource(resource: any, preferHorizontal: boolean): number {
  const imageUrl = String(resource?.image?.source?.url ?? "");
  const type = String(resource?.image?.type ?? "").toLowerCase();
  const orientation = String(resource?.image?.orientation ?? "").toLowerCase();

  let score = 0;
  if (imageUrl.includes("img.freepik.com")) score += 50;
  if (type === "photo") score += 30;
  if (type === "vector" || type === "illustration") score += 20;
  if (preferHorizontal && orientation === "horizontal") score += 10;
  if (!preferHorizontal && orientation === "vertical") score += 2;
  if (String(resource?.url ?? "").includes("freepik.com")) score += 2;
  return score;
}

export async function searchFreepikImage(params: {
  term: string;
  preferHorizontal?: boolean;
  limit?: number;
}): Promise<FreepikImageCandidate | null> {
  if (!hasFreepikKey()) return null;

  const term = params.term.trim();
  if (!term) return null;

  const qs = new URLSearchParams({
    term,
    limit: String(params.limit ?? 12),
    order: "relevance"
  });

  const url = `${joinUrl(env.FREEPIK_API_BASE_URL, "/v1/resources")}?${qs.toString()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-freepik-api-key": env.FREEPIK_API_KEY
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Freepik API error (status ${response.status}). ${text.slice(0, 500)}`);
  }

  const json: any = await response.json();
  const data: any[] = Array.isArray(json?.data) ? json.data : [];
  if (!data.length) return null;

  const preferHorizontal = params.preferHorizontal ?? true;
  const ranked = [...data]
    .filter((item) => typeof item === "object" && item)
    .map((item) => ({ item, score: scoreResource(item, preferHorizontal) }))
    .filter((entry) => String(entry.item?.image?.source?.url ?? "").startsWith("http"))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.item;
  if (!best) return null;

  const imageUrl = String(best?.image?.source?.url ?? "");
  if (!imageUrl) return null;

  const licenses: any[] = Array.isArray(best?.licenses) ? best.licenses : [];
  const firstLicenseUrl = licenses.find((lic) => typeof lic?.url === "string")?.url as string | undefined;

  return {
    id: best?.id ?? "unknown",
    title: String(best?.title ?? "Imagen Freepik"),
    pageUrl: typeof best?.url === "string" ? best.url : null,
    imageUrl,
    authorName: typeof best?.author?.name === "string" ? best.author.name : undefined,
    licenseUrl: typeof firstLicenseUrl === "string" ? firstLicenseUrl : undefined
  };
}

