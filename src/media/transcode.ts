import sharp from "sharp";

// Never trust the client-declared content type. Sniff the actual bytes (§6e): an attacker can
// upload an HTML/script payload with a "image/png" content type, and a same-origin SVG can carry
// scripts. We detect the real format, then re-encode through Sharp which strips any embedded
// script/metadata and produces a known-safe raster.

export type Sniffed = "png" | "jpeg" | "gif" | "webp" | "svg" | "unknown";

const startsWith = (b: Uint8Array, sig: number[], off = 0) => sig.every((n, i) => b[off + i] === n);

export function sniff(bytes: Uint8Array): Sniffed {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif"; // GIF8
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  // SVG: an XML/whitespace prefix followed by "<svg" somewhere near the start.
  const head = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart().toLowerCase();
  if (head.startsWith("<?xml") || head.startsWith("<svg")) {
    if (head.includes("<svg")) return "svg";
  }
  return "unknown";
}

export interface Derivatives {
  display: { bytes: Uint8Array; contentType: string };
  thumb: { bytes: Uint8Array; contentType: string };
}

const THUMB_PX = 256;

// Produce sanitised display + thumbnail derivatives. SVG is rasterised to PNG at 2x density for
// retina; raster inputs are re-encoded (which drops metadata and any trailing payload).
export async function transcode(bytes: Uint8Array, kind: Sniffed): Promise<Derivatives> {
  if (kind === "unknown") throw new Error("unsupported media type");

  // density only affects vector (SVG) rasterisation; harmless for rasters.
  const input = () => sharp(bytes, { density: 192, failOn: "error" });

  const display =
    kind === "svg"
      ? { bytes: new Uint8Array(await input().png().toBuffer()), contentType: "image/png" }
      : kind === "gif"
        ? { bytes: new Uint8Array(await input().gif().toBuffer()), contentType: "image/gif" }
        : { bytes: new Uint8Array(await input().webp({ quality: 90 }).toBuffer()), contentType: "image/webp" };

  const thumb = {
    bytes: new Uint8Array(
      await sharp(bytes, { density: 96, failOn: "error" })
        .resize(THUMB_PX, THUMB_PX, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer(),
    ),
    contentType: "image/webp",
  };

  return { display, thumb };
}
