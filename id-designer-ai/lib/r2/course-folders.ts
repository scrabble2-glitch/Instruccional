import { env } from "@/lib/env";
import { stableSlugWithHash } from "@/lib/utils/slug";
import { buildR2PutObjectUrl, signAwsRequest } from "@/lib/r2/sigv4";

function isR2Configured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_BUCKET
  );
}

export function buildCourseFolderPrefix(courseName: string): string {
  const base = env.R2_PREFIX_BASE || "cursos";
  const folder = stableSlugWithHash(courseName);
  return `${base}/${folder}`;
}

export async function ensureCourseFolderInR2(courseName: string): Promise<
  | { enabled: false; skipped: true; reason: string }
  | { enabled: true; skipped: false; prefix: string }
> {
  if (!isR2Configured()) {
    return {
      enabled: false,
      skipped: true,
      reason: "R2 no está configurado (faltan variables de entorno)."
    };
  }

  const prefix = buildCourseFolderPrefix(courseName);
  const key = `${prefix}/.keep`;

  const url = buildR2PutObjectUrl({
    accountId: env.R2_ACCOUNT_ID,
    bucket: env.R2_BUCKET,
    key
  });

  const signed = signAwsRequest({
    method: "PUT",
    url,
    service: "s3",
    region: env.R2_REGION || "auto",
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY
    },
    body: ""
  });

  const response = await fetch(signed.url, {
    method: "PUT",
    headers: signed.headers,
    body: ""
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `No fue posible crear carpeta en R2 (status ${response.status}). ${text.slice(0, 500)}`
    );
  }

  return {
    enabled: true,
    skipped: false,
    prefix: `${prefix}/`
  };
}

