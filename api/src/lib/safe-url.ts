import { z } from "zod";

// Block javascript:/data:/vbscript:/file:/ftp: — only http(s) URLs may be stored or rendered
// (§4d/7e). Apply at the DB write path, not just the API edge.
const SAFE_SCHEMES = new Set(["http:", "https:"]);

export const SafeUrl = z.string().url().refine(
  (u) => {
    try {
      return SAFE_SCHEMES.has(new URL(u).protocol);
    } catch {
      return false;
    }
  },
  { message: "Only http and https URLs are allowed" },
);

export function isSafeUrl(u: string): boolean {
  return SafeUrl.safeParse(u).success;
}
