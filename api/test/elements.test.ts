import { expect, test } from "bun:test";
import { Element } from "@/elements/schema.ts";
import { isSafeUrl } from "@/lib/safe-url.ts";
import { decodeCursor, encodeCursor } from "@/lib/pagination.ts";

test("link element rejects javascript: scheme (§4d)", () => {
  const bad = Element.safeParse({ id: "1", type: "link", x: 0, y: 0, w: 10, h: 10, url: "javascript:alert(1)" });
  expect(bad.success).toBe(false);
});

test("link element accepts https url", () => {
  const ok = Element.safeParse({ id: "1", type: "link", x: 0, y: 0, w: 10, h: 10, url: "https://example.com" });
  expect(ok.success).toBe(true);
});

test("note style rejects non-hex fill (§4b)", () => {
  const bad = Element.safeParse({
    id: "1",
    type: "note",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    text: "hi",
    style: { fill: "red; background:url(x)" },
  });
  expect(bad.success).toBe(false);
});

test("note style accepts #rrggbb", () => {
  const ok = Element.safeParse({ id: "1", type: "note", x: 0, y: 0, w: 10, h: 10, text: "hi", style: { fill: "#ff8800" } });
  expect(ok.success).toBe(true);
});

test("unknown element type rejected", () => {
  expect(Element.safeParse({ id: "1", type: "iframe", x: 0, y: 0, w: 1, h: 1 }).success).toBe(false);
});

test.each(["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://h/x", "vbscript:x"])(
  "isSafeUrl blocks %s",
  (u) => expect(isSafeUrl(u)).toBe(false),
);

test("cursor round-trips a timestamp", () => {
  const d = new Date("2026-01-02T03:04:05.000Z");
  expect(decodeCursor(encodeCursor(d))?.toISOString()).toBe(d.toISOString());
  expect(decodeCursor(null)).toBeNull();
  expect(decodeCursor("not-base64-@@@")).toBeNull();
});
