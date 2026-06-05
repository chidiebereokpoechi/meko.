import { S3Client } from "bun";
import { config, s3Endpoints } from "@/config.ts";

// S3-compatible object storage (RustFS/MinIO/S3) via Bun's native client. Path-style addressing
// (virtualHostedStyle=false) is required for self-hosted endpoints that don't do vhost buckets.
//
// Two clients with identical creds/region/bucket but different endpoints:
//   internal — the app's own put/get/delete (typically a LAN address).
//   public   — signs presigned URLs the BROWSER fetches. SigV4 binds the host, so these MUST be
//              signed for the public host; presign is local HMAC, so no network is involved.

export const mediaEnabled = s3Endpoints.internal.length > 0;

const common = {
  region: config.S3_REGION,
  bucket: config.S3_BUCKET,
  accessKeyId: config.S3_ACCESS_KEY,
  secretAccessKey: config.S3_SECRET_KEY,
  virtualHostedStyle: false as const,
};

const internal = mediaEnabled ? new S3Client({ ...common, endpoint: s3Endpoints.internal }) : null;
const publicClient = mediaEnabled ? new S3Client({ ...common, endpoint: s3Endpoints.public }) : null;

function req<T>(c: T | null): T {
  if (!c) throw new Error("media storage is not configured (S3_ENDPOINT empty)");
  return c;
}

// Presigned PUT for direct browser upload — signed for the public host. Short expiry.
export function presignPut(key: string, contentType: string, expiresIn = 300): string {
  return req(publicClient).presign(key, { method: "PUT", expiresIn, type: contentType });
}

// Presigned GET so board data never proxies through the app process.
export function presignGet(key: string, expiresIn = 300): string {
  return req(publicClient).presign(key, { method: "GET", expiresIn });
}

export async function getBytes(key: string): Promise<Uint8Array> {
  return new Uint8Array(await req(internal).file(key).arrayBuffer());
}

export async function putBytes(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  await req(internal).write(key, bytes, { type: contentType });
}

export async function deleteObject(key: string): Promise<void> {
  await req(internal).delete(key);
}
