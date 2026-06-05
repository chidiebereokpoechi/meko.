import { expect, test } from "bun:test";
import sharp from "sharp";
import { sniff, transcode } from "@/media/transcode.ts";
import { ALLOWED_UPLOAD_TYPES, displayKey, rawKey, thumbKey } from "@/media/keys.ts";

const SVG = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#0a0"/></svg>`);
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50;
const isWebp = (b: Uint8Array) => b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;

test("sniff detects formats from magic bytes", async () => {
  const png = new Uint8Array(await sharp(SVG, { density: 96 }).png().toBuffer());
  const jpeg = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).jpeg().toBuffer());
  const webp = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).webp().toBuffer());
  expect(sniff(png)).toBe("png");
  expect(sniff(jpeg)).toBe("jpeg");
  expect(sniff(webp)).toBe("webp");
  expect(sniff(new Uint8Array(SVG))).toBe("svg");
  expect(sniff(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBe("unknown");
  expect(sniff(new Uint8Array([1, 2, 3, 4]))).toBe("unknown");
});

test("SVG transcodes to a rasterised PNG display derivative (§6e)", async () => {
  const { display, thumb } = await transcode(new Uint8Array(SVG), "svg");
  expect(display.contentType).toBe("image/png");
  expect(isPng(display.bytes)).toBe(true);
  expect(thumb.contentType).toBe("image/webp");
  expect(isWebp(thumb.bytes)).toBe(true);
});

test("raster input re-encodes to webp (strips embedded payload)", async () => {
  const png = new Uint8Array(await sharp(SVG, { density: 96 }).png().toBuffer());
  const { display } = await transcode(png, "png");
  expect(display.contentType).toBe("image/webp");
  expect(isWebp(display.bytes)).toBe(true);
});

test("transcode rejects unknown type", async () => {
  await expect(transcode(new Uint8Array([0, 1, 2]), "unknown")).rejects.toThrow();
});

test("key layout + allowlist", () => {
  expect(rawKey("b", "m")).toBe("boards/b/raw/m");
  expect(displayKey("b", "m", "png")).toBe("boards/b/display/m.png");
  expect(thumbKey("b", "m")).toBe("boards/b/thumb/m.webp");
  expect(ALLOWED_UPLOAD_TYPES.has("image/svg+xml")).toBe(true);
  expect(ALLOWED_UPLOAD_TYPES.has("text/html")).toBe(false);
});

// Real round-trip against a live S3/RustFS endpoint. Opt-in via S3_LIVE=1 (needs the bucket to
// exist): `S3_LIVE=1 bun test test/media.test.ts`.
test.skipIf(!process.env.S3_LIVE)("S3 put/presign round-trip", async () => {
  const { putBytes, getBytes, presignGet } = await import("@/lib/storage.ts");
  const key = `test/roundtrip-${Date.now()}`;
  const payload = new Uint8Array([1, 2, 3, 4, 5]);
  await putBytes(key, payload, "application/octet-stream");
  expect(await getBytes(key)).toEqual(payload);
  expect(presignGet(key)).toContain(key);
});
