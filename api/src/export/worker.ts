import { config } from "@/config.ts";
import { log } from "@/lib/logger.ts";
import { renderExport } from "@/export/chromium.ts";

// Isolated export sidecar — the only process that runs Chromium (§8b). It has NO database, Redis,
// or S3 client: it reaches the API and nothing else. Loop: claim an export job from the API,
// render the API's self-contained HTML with Chromium, post the bytes back to the API (which writes
// to S3 + DB). Chromium itself is locked to the API host via --host-rules.

const API = config.MEKO_API_INTERNAL_URL;
const TOKEN = config.MEKO_INTERNAL_TOKEN;
const auth = { "x-internal-token": TOKEN };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Claim {
  none?: boolean;
  jobId?: string;
  exportId?: string;
  format?: "png" | "pdf";
}

async function once(): Promise<boolean> {
  const claim = (await (await fetch(`${API}/api/internal/export-claim`, { method: "POST", headers: auth })).json()) as Claim;
  if (claim.none || !claim.exportId || !claim.jobId || !claim.format) return false;

  const renderUrl = `${API}/api/internal/export-render/${claim.exportId}`;
  try {
    const bytes = await renderExport(renderUrl, claim.format, TOKEN);
    await fetch(`${API}/api/internal/export-result/${claim.exportId}?jobId=${claim.jobId}&status=ok`, {
      method: "POST",
      headers: { ...auth, "content-type": claim.format === "pdf" ? "application/pdf" : "image/png" },
      body: bytes,
    });
    log.info({ action: "export.rendered", exportId: claim.exportId }, "export rendered");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, action: "export.render_fail", exportId: claim.exportId }, "render failed");
    await fetch(`${API}/api/internal/export-result/${claim.exportId}?jobId=${claim.jobId}&status=fail&error=${encodeURIComponent(message)}`, { method: "POST", headers: auth });
  }
  return true;
}

let running = true;
process.on("SIGINT", () => (running = false));
process.on("SIGTERM", () => (running = false));

log.info({ action: "export-sidecar.start", api: API }, "export sidecar started");
(async () => {
  while (running) {
    let did = false;
    try {
      did = await once();
    } catch (err) {
      log.error({ err, action: "export.loop_fail" }, "export loop error");
    }
    if (!did) await sleep(1500);
  }
  process.exit(0);
})();
