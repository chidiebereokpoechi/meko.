import { ssrfSafeUrl, SsrfError } from "@/lib/ssrf.ts";
import { config } from "@/config.ts";

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8000;

// Read a response body into bytes, aborting once the cap is exceeded (so a malicious host can't
// stream an unbounded image to exhaust memory).
async function readCapped(res: Response, cap: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel();
        throw new SsrfError("image exceeds size limit");
      }
      chunks.push(value);
    }
  }
  return new Uint8Array(Buffer.concat(chunks));
}

// Fetch a remote image server-side, SSRF-guarded on every hop (§7), with a timeout and a hard size
// cap. Returns the raw bytes + declared content-type for the media pipeline to re-sniff. Throws
// SsrfError for unsafe URLs / oversize / non-image responses.
export async function fetchRemoteImage(
  rawUrl: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await ssrfSafeUrl(current); // re-checked every hop (DNS + private-range guard)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          accept: "image/*,*/*;q=0.8",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new SsrfError("redirect without location");
      current = new URL(loc, current).toString(); // loop re-runs the SSRF check on the new target
      continue;
    }
    if (!res.ok) throw new SsrfError(`upstream ${res.status}`);

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!contentType.startsWith("image/"))
      throw new SsrfError("not an image response");
    const bytes = await readCapped(res, config.MEKO_MAX_UPLOAD_BYTES);
    return { bytes, contentType };
  }
  throw new SsrfError("too many redirects");
}
