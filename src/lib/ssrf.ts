import { lookup } from "node:dns/promises";
import { isSafeUrl } from "@/lib/safe-url.ts";
import { securityEvent } from "@/lib/logger.ts";

// SSRF defence for outbound fetches (unfurl, future webhooks). Block any URL that resolves to a
// non-public address — private ranges, loopback, link-local (incl. the 169.254.169.254 cloud
// metadata endpoint), CGNAT, multicast, reserved. Validate the resolved IP, not just the string,
// because DNS can point a public name at a private address (§7).

export class SsrfError extends Error {}

function v4Private(a: number, b: number, _c: number, _d: number): boolean {
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 192 && b === 0 && _c === 0) return true; // 192.0.0/24
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved + 255.255.255.255
  return false;
}

function parseV4(addr: string): [number, number, number, number] | null {
  const parts = addr.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
}

export function isPrivateIp(addr: string): boolean {
  const v4 = parseV4(addr);
  if (v4) return v4Private(...v4);

  // IPv6.
  const ip = addr.toLowerCase().split("%")[0]!; // strip zone id
  if (ip === "::1" || ip === "::") return true; // loopback / unspecified
  // v4-mapped (::ffff:a.b.c.d) and v4-compatible — classify by the embedded v4.
  const mapped = ip.match(/::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const embedded = parseV4(mapped[1]!);
    return embedded ? v4Private(...embedded) : true;
  }
  const head = ip.split(":")[0] ?? "";
  const h = parseInt(head || "0", 16);
  if ((h & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((h & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

export interface ResolvedUrl {
  url: string;
  ip: string;
}

// Validate scheme, resolve the host, and reject if ANY resolved address is non-public. Returns
// the first resolved IP so callers can record it (§7e: store the IP at unfurl time).
export async function ssrfSafeUrl(raw: string): Promise<ResolvedUrl> {
  if (!isSafeUrl(raw)) {
    securityEvent("ssrf.block", { reason: "scheme", url: raw });
    throw new SsrfError("unsafe URL scheme");
  }
  const host = new URL(raw).hostname;

  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new SsrfError("DNS resolution failed");
  }
  if (!addrs.length) throw new SsrfError("no addresses");

  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      securityEvent("ssrf.block", { reason: "private_ip", host, address });
      throw new SsrfError("URL resolves to a non-public address");
    }
  }
  return { url: raw, ip: addrs[0]!.address };
}
