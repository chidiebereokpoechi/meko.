import puppeteer from "puppeteer-core";
import { config } from "@/config.ts";

// Launch flags harden the sidecar (§8b): host-rules MAP everything to 0.0.0.0 except the API host,
// so even if a board injected a remote reference, Chromium cannot reach S3/Postgres/Redis, the
// cloud metadata endpoint, or any external site. The sidecar also runs as a non-root user and
// sits on a network that can only reach the API (compose).
function launchArgs(): string[] {
  return [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    `--host-rules=MAP * 0.0.0.0, EXCLUDE ${config.EXPORT_ALLOWED_HOST}`,
  ];
}

// Render the internal export-render URL to a PNG or PDF buffer. The page is fully self-contained
// HTML served by the API, so no external fetch is needed.
export async function renderExport(renderUrl: string, format: "png" | "pdf", internalToken: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch({ executablePath: config.CHROMIUM_PATH, args: launchArgs(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "x-internal-token": internalToken });
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
    await page.goto(renderUrl, { waitUntil: "networkidle0", timeout: 30_000 });
    const out = format === "pdf" ? await page.pdf({ printBackground: true }) : await page.screenshot({ fullPage: true, type: "png" });
    return new Uint8Array(out);
  } finally {
    await browser.close();
  }
}
