// Embed helpers.
// - providerEmbedUrl: a KNOWN embeddable provider URL → its iframe src, else null. Used by the
//   normal URL paste/drop flow to auto-embed (YouTube, Vimeo, Loom, Figma, Spotify, …).
// - extractIframeSrc: pull the src out of a pasted <iframe …> snippet (e.g. Spotify's embed code).
// - toEmbedUrl: the Embed tool's input — accepts an iframe snippet, a provider URL, or any http(s)
//   URL (embedded directly).

function providerEmbedUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\./, "");

  if (host === "youtu.be") return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
  if (host.endsWith("youtube.com")) {
    const id = u.searchParams.get("v");
    if (id) return `https://www.youtube.com/embed/${id}`;
    if (u.pathname.startsWith("/embed/")) return u.toString();
    if (u.pathname.startsWith("/shorts/")) return `https://www.youtube.com/embed/${u.pathname.split("/")[2]}`;
  }
  if (host === "vimeo.com") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
  }
  if (host.endsWith("loom.com") && u.pathname.includes("/share/")) return u.toString().replace("/share/", "/embed/");
  if (host.endsWith("figma.com") && /^\/(file|design|board|proto|slides)\//.test(u.pathname)) {
    return `https://www.figma.com/embed?embed_host=meko&url=${encodeURIComponent(raw)}`;
  }
  if (host === "open.spotify.com") {
    if (u.pathname.startsWith("/embed/")) return `https://open.spotify.com${u.pathname}`;
    const m = u.pathname.match(/^\/(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
    if (m) return `https://open.spotify.com/embed/${m[1]}/${m[2]}`;
  }
  return null;
}

// Resolve a known provider URL to its embed src — null if not a recognised provider.
export function embeddableUrl(raw: string): string | null {
  return providerEmbedUrl(raw);
}

// Pull the src from a pasted <iframe …src="…"…> snippet; null if not an iframe snippet.
export function extractIframeSrc(input: string): string | null {
  if (!/<iframe/i.test(input)) return null;
  const m = input.match(/src=["']([^"']+)["']/i);
  if (!m) return null;
  try {
    const u = new URL(m[1]!);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// Embed tool input → an iframe src. Accepts an <iframe> snippet, a provider URL, or any http(s) URL.
export function toEmbedUrl(input: string): string | null {
  const fromIframe = extractIframeSrc(input);
  if (fromIframe) return fromIframe;
  const provider = providerEmbedUrl(input);
  if (provider) return provider;
  try {
    const u = new URL(input.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// Sensible initial card size for an embed src (providers have fixed/native aspect ratios).
export function embedDefaultSize(src: string): { w: number; h: number } {
  const w = 360;
  try {
    const u = new URL(src);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "open.spotify.com") {
      // Spotify: compact player for a single track/episode, tall player for collections.
      return /\/embed\/(track|episode)\//.test(u.pathname) ? { w, h: 152 } : { w, h: 352 };
    }
    if (host.endsWith("figma.com")) return { w: 420, h: 300 };
    // YouTube / Vimeo / Loom and most video: 16:9.
    return { w, h: Math.round((w * 9) / 16) };
  } catch {
    return { w, h: 203 };
  }
}

export function embedHost(src: string): string {
  try {
    return new URL(src).hostname.replace(/^www\./, "");
  } catch {
    return src;
  }
}
