import { ssrfSafeUrl, SsrfError } from "@/lib/ssrf.ts";
import { isSafeUrl } from "@/lib/safe-url.ts";

// Link unfurling. Every outbound hop is SSRF-checked (§7); redirects are followed manually so a
// 302 to a private address can't slip past the initial check. Response reading is bounded in time
// and size so a malicious server can't hang or exhaust memory.

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 5000;
// Some sites (Pinterest, other SPAs) inject their OG meta tags late in the document — Pinterest's
// sit near ~900KB — so a small cap misses them. 2 MiB covers these while still bounding memory.
const MAX_HTML_BYTES = 2 * 1024 * 1024;

export interface UnfurlResult {
  url: string;
  resolvedIp: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
}

function metaContent(html: string, prop: string): string | null {
  // Match <meta property="og:x" content="..."> in either attribute order.
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeEntities(m[1]!.trim());
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

// <link rel="image_src" href="..."> fallback (either attribute order).
function linkRelImage(html: string): string | null {
  const m =
    html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i) ??
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']image_src["']/i);
  return m ? decodeEntities(m[1]!.trim()) : null;
}

// Amazon product pages emit no og:image; the main image lives in
// data-a-dynamic-image="{"<url>":[w,h], ...}" (entity-encoded JSON). Pick the largest by area.
function dynamicImage(html: string): string | null {
  const m = html.match(/data-a-dynamic-image=["'](\{[^"']+\})["']/i);
  if (!m) return null;
  try {
    const map = JSON.parse(decodeEntities(m[1]!)) as Record<string, [number, number]>;
    let best: string | null = null;
    let bestArea = -1;
    for (const [url, dims] of Object.entries(map)) {
      const area = Array.isArray(dims) ? (dims[0] ?? 0) * (dims[1] ?? 0) : 0;
      if (area > bestArea) {
        bestArea = area;
        best = url;
      }
    }
    return best;
  } catch {
    return null;
  }
}

// Pure parser — unit-testable without any network.
export function parseOpenGraph(html: string, baseUrl: string): Omit<UnfurlResult, "resolvedIp"> {
  const title = metaContent(html, "og:title") ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
  const description = metaContent(html, "og:description") ?? metaContent(html, "description");
  // Image fallback chain: Open Graph → Twitter card → <link rel=image_src> → Amazon dynamic image.
  let imageUrl = metaContent(html, "og:image") ?? metaContent(html, "twitter:image") ?? linkRelImage(html) ?? dynamicImage(html);
  // Resolve a relative og:image against the page URL, and drop anything non-http(s).
  if (imageUrl) {
    try {
      imageUrl = new URL(imageUrl, baseUrl).toString();
    } catch {
      imageUrl = null;
    }
    if (imageUrl && !isSafeUrl(imageUrl)) imageUrl = null;
  }
  return { url: baseUrl, title: title ? decodeEntities(title) : null, description, imageUrl };
}

// Read at most MAX_HTML_BYTES from the body so a huge/streaming response can't exhaust memory.
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
      if (total >= MAX_HTML_BYTES) {
        await reader.cancel();
        break;
      }
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_HTML_BYTES));
}

export async function unfurl(rawUrl: string): Promise<UnfurlResult> {
  let current = rawUrl;
  let resolvedIp = "";

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = await ssrfSafeUrl(current); // re-checked every hop
    resolvedIp = checked.ip;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: ctrl.signal,
        // Many sites (Pinterest, etc.) only emit Open Graph tags to a real browser UA; a custom
        // bot UA gets a login/consent wall with no og:image. Present as a browser.
        headers: {
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      current = new URL(loc, current).toString(); // loop re-runs the SSRF check on the new target
      continue;
    }

    // A non-2xx response (e.g. eBay's Akamai bot wall returns a 403 with an HTML "Error Page")
    // still carries text/html — parsing it would surface the error page's <title> as the link
    // title. Treat it as no preview; the route won't cache an empty result, so it retries later.
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { url: current, resolvedIp, title: null, description: null, imageUrl: null };
    }

    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("text/html")) {
      return { url: current, resolvedIp, title: null, description: null, imageUrl: null };
    }
    const html = await readCapped(res);
    return { resolvedIp, ...parseOpenGraph(html, current) };
  }
  throw new SsrfError("too many redirects");
}
