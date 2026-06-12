import { afterAll, beforeAll, expect, test } from "bun:test";
import { isPrivateIp, ssrfSafeUrl, SsrfError } from "@/lib/ssrf.ts";
import { parseOpenGraph, unfurl } from "@/links/unfurl.ts";

test("isPrivateIp blocks private/reserved IPv4", () => {
  for (const ip of ["0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255"]) {
    expect(isPrivateIp(ip)).toBe(true);
  }
});

test("isPrivateIp allows public IPv4", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "93.184.216.34"]) {
    expect(isPrivateIp(ip)).toBe(false);
  }
});

test("isPrivateIp handles IPv6 (loopback, ULA, link-local, v4-mapped, metadata)", () => {
  expect(isPrivateIp("::1")).toBe(true);
  expect(isPrivateIp("fc00::1")).toBe(true);
  expect(isPrivateIp("fe80::1")).toBe(true);
  expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true);
  expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true);
  expect(isPrivateIp("2606:4700:4700::1111")).toBe(false); // public (1.1.1.1)
});

test("ssrfSafeUrl rejects unsafe schemes and private targets", async () => {
  await expect(ssrfSafeUrl("javascript:alert(1)")).rejects.toBeInstanceOf(SsrfError);
  await expect(ssrfSafeUrl("file:///etc/passwd")).rejects.toBeInstanceOf(SsrfError);
  await expect(ssrfSafeUrl("http://127.0.0.1/")).rejects.toBeInstanceOf(SsrfError);
  await expect(ssrfSafeUrl("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(SsrfError);
  await expect(ssrfSafeUrl("http://localhost:8080/")).rejects.toBeInstanceOf(SsrfError);
});

test("parseOpenGraph extracts OG tags and resolves relative image", () => {
  const html = `<html><head>
    <meta property="og:title" content="Hello &amp; World">
    <meta name="og:description" content="A page">
    <meta property="og:image" content="/img/cover.png">
  </head><body></body></html>`;
  const r = parseOpenGraph(html, "https://example.com/post");
  expect(r.title).toBe("Hello & World");
  expect(r.description).toBe("A page");
  expect(r.imageUrl).toBe("https://example.com/img/cover.png");
});

test("parseOpenGraph drops non-http(s) og:image and falls back to <title>", () => {
  const r = parseOpenGraph(`<title>Plain</title><meta property="og:image" content="javascript:alert(1)">`, "https://example.com");
  expect(r.title).toBe("Plain");
  expect(r.imageUrl).toBeNull();
});

test("parseOpenGraph falls back to twitter:image when og:image is absent", () => {
  const r = parseOpenGraph(`<meta name="twitter:image" content="https://example.com/t.png">`, "https://example.com");
  expect(r.imageUrl).toBe("https://example.com/t.png");
});

test("parseOpenGraph falls back to <link rel=image_src>", () => {
  const r = parseOpenGraph(`<link rel="image_src" href="https://example.com/ls.png">`, "https://example.com");
  expect(r.imageUrl).toBe("https://example.com/ls.png");
});

test("parseOpenGraph extracts Amazon data-a-dynamic-image (largest by area)", () => {
  // Amazon emits no og:image; the product image is in an entity-encoded JSON map of url -> [w,h].
  const html = `<img id="landingImage" data-a-dynamic-image="{&quot;https://m.media-amazon.com/s.jpg&quot;:[355,355],&quot;https://m.media-amazon.com/l.jpg&quot;:[679,679]}">`;
  const r = parseOpenGraph(html, "https://www.amazon.com/dp/X");
  expect(r.imageUrl).toBe("https://m.media-amazon.com/l.jpg");
});

// A real loopback HTTP server must be refused by unfurl because it resolves to 127.0.0.1 (§7).
let server: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: () => new Response("<title>secret</title>", { headers: { "content-type": "text/html" } }) });
});
afterAll(() => server?.stop(true));

test("unfurl refuses a loopback URL (SSRF)", async () => {
  await expect(unfurl(`http://127.0.0.1:${server.port}/`)).rejects.toBeInstanceOf(SsrfError);
});
