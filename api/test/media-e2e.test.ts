import { afterAll, beforeAll, expect, test } from "bun:test";

// Full media pipeline against live RustFS. Opt-in: S3_LIVE=1 (bucket must exist).
// presign PUT → browser PUT → process-upload (run in-process) → ready → fetch display derivative.
const LIVE = !!process.env.S3_LIVE;
const PORT = 3401;
const BASE = `http://localhost:${PORT}`;
let node: ReturnType<typeof Bun.spawn>;
let token: string;
let boardId: string;

const J = (extra: Record<string, string> = {}) => ({ "content-type": "application/json", ...extra });
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#3366ff"/></svg>`;

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {}
    await Bun.sleep(250);
  }
  throw new Error("node never healthy");
}

beforeAll(async () => {
  if (!LIVE) return;
  node = Bun.spawn(["bun", "run", "src/index.ts"], {
    env: { ...process.env, PORT: String(PORT), NODE_ID: "media-e2e", LOG_LEVEL: "warn", MEKO_ALLOWED_ORIGINS: "http://localhost", MEKO_SIGNUP_MODE: "open", MEKO_BOOTSTRAP_EMAILS: "" },
    stdout: "inherit",
    stderr: "inherit",
  });
  await waitHealthy();

  const signup = await (await fetch(`${BASE}/api/auth/signup`, { method: "POST", headers: J({ "x-forwarded-for": "10.5.5.5" }), body: JSON.stringify({ email: `m${Date.now()}@x.test`, password: "supersecret", displayName: "M" }) })).json();
  token = signup.accessToken;
  const ws = await (await fetch(`${BASE}/api/workspaces`, { method: "POST", headers: J({ authorization: `Bearer ${token}` }), body: JSON.stringify({ name: "M" }) })).json();
  const board = await (await fetch(`${BASE}/api/workspaces/${ws.id}/boards`, { method: "POST", headers: J({ authorization: `Bearer ${token}` }), body: JSON.stringify({ title: "m" }) })).json();
  boardId = board.id;
});

afterAll(() => node?.kill());

test.skipIf(!LIVE)("upload → transcode → display derivative is a PNG", async () => {
  const H = J({ authorization: `Bearer ${token}` });

  // 1. presign
  const up = await (await fetch(`${BASE}/api/boards/${boardId}/uploads`, { method: "POST", headers: H, body: JSON.stringify({ contentType: "image/svg+xml" }) })).json();
  expect(up.uploadUrl).toBeString();

  // 2. browser PUT the SVG to the presigned URL
  const put = await fetch(up.uploadUrl, { method: "PUT", headers: { "content-type": "image/svg+xml" }, body: SVG });
  expect(put.status).toBeLessThan(300);

  // 3. run the worker job in-process (avoids spawning the worker for the test)
  const { processUpload } = await import("@/media/process.ts");
  await processUpload(up.mediaId);

  // 4. media is ready, display derivative resolves
  const media = await (await fetch(`${BASE}/api/media/${up.mediaId}`, { headers: H })).json();
  expect(media.status).toBe("ready");
  expect(media.displayUrl).toBeString();

  // 5. fetch the display derivative — SVG must have been rasterised to PNG (§6e)
  const img = new Uint8Array(await (await fetch(media.displayUrl)).arrayBuffer());
  expect(img[0] === 0x89 && img[1] === 0x50).toBe(true); // PNG magic
});
