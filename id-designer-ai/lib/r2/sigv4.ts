import { createHmac, createHash } from "crypto";

function toHex(buffer: Buffer): string {
  return buffer.toString("hex");
}

function sha256Hex(payload: string | Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function formatAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");

  const dateStamp = `${yyyy}${mm}${dd}`;
  const amzDate = `${dateStamp}T${hh}${min}${ss}Z`;
  return { amzDate, dateStamp };
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment);
}

function encodeS3Key(key: string): string {
  return key
    .split("/")
    .map((segment) => encodePathSegment(segment))
    .join("/");
}

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SigV4SignParams {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  service: string;
  region: string;
  credentials: SigV4Credentials;
  now?: Date;
}

export function signAwsRequest(params: SigV4SignParams): { url: string; headers: Record<string, string> } {
  const now = params.now ?? new Date();
  const { amzDate, dateStamp } = formatAmzDate(now);

  const url = new URL(params.url);
  const host = url.host;

  const method = params.method.toUpperCase();
  const payload = params.body ?? "";
  const payloadHash = sha256Hex(payload);

  // Canonical URI must match the encoded path that will be sent on the wire.
  // `buildR2PutObjectUrl` already URI-encodes each key segment, so we can use
  // `url.pathname` as-is here to avoid double-encoding.
  const canonicalUri = url.pathname;

  const canonicalQuery = url.searchParams.toString();

  const baseHeaders: Record<string, string> = {
    ...(params.headers ?? {}),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };

  // Only sign required headers to avoid mismatch with intermediaries.
  const canonicalHeaders = `host:${host}\n` + `x-amz-content-sha256:${baseHeaders["x-amz-content-sha256"]}\n` + `x-amz-date:${baseHeaders["x-amz-date"]}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");

  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${params.region}/${params.service}/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");

  const kDate = hmacSha256(`AWS4${params.credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, params.region);
  const kService = hmacSha256(kRegion, params.service);
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = toHex(hmacSha256(kSigning, stringToSign));

  const authorization = `${algorithm} Credential=${params.credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: params.url,
    headers: {
      ...(params.headers ?? {}),
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization
    }
  };
}

export function buildR2PutObjectUrl(params: { accountId: string; bucket: string; key: string }): string {
  const encodedKey = encodeS3Key(params.key);
  return `https://${params.accountId}.r2.cloudflarestorage.com/${params.bucket}/${encodedKey}`;
}
