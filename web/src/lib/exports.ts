import { api } from "./api.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Phase-7 export: request a render, then poll until the Chromium sidecar finishes and the result
// is presigned. Requires the export-sidecar to be running; otherwise it stays pending and times
// out. Returns the download URL.
export async function requestExport(boardId: string, format: "png" | "pdf"): Promise<string> {
  const { id } = await api<{ id: string }>(`/api/boards/${boardId}/exports`, {
    method: "POST",
    body: JSON.stringify({ format }),
  });

  for (let i = 0; i < 60; i++) {
    const e = await api<{ status: string; url?: string }>(`/api/exports/${id}`);
    if (e.status === "ready" && e.url) return e.url;
    if (e.status === "failed") throw new Error("export failed");
    await sleep(1000);
  }
  throw new Error("export timed out (is the export sidecar running?)");
}
