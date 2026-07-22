import { lookup } from "node:dns/promises";
import net from "node:net";
import type { Page } from "puppeteer";

// SSRF guard for headless-Chrome rendering (PDF export).
// The rendered HTML is user-controlled, so Chromium must not be allowed
// to fetch INTERNAL resources (cloud metadata server, localhost,
// private networks) while still loading legitimate PUBLIC ones (fonts,
// images, CDNs). We intercept every request and abort only those whose
// resolved address is private/internal — public resources pass through,
// so the render looks identical to the browser.

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // unparseable → treat as unsafe
  }
  const [a, b] = p;
  return (
    a === 0 || // "this" network
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local (incl. 169.254.169.254 metadata)
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) // private
  );
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true; // loopback / unspecified
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return isPrivateIPv4(mapped[1]);
  return (
    v.startsWith("fe80") || // link-local
    v.startsWith("fc") ||
    v.startsWith("fd") // unique-local fc00::/7
  );
}

function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true; // not a recognizable IP → block
}

// Whether Chromium may load this resource. data:/blob:/about: are inline
// (no network) and allowed; file:/ftp:/etc. are blocked; http(s) is
// allowed only when the host resolves entirely to public addresses.
export async function isSafeResourceUrl(rawUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (
    url.protocol === "data:" ||
    url.protocol === "blob:" ||
    url.protocol === "about:"
  ) {
    return true;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false; // file:, ftp:, chrome:, etc.
  }
  const host = url.hostname;
  if (net.isIP(host)) return !isPrivateIp(host);
  try {
    const addrs = await lookup(host, { all: true });
    if (addrs.length === 0) return false;
    // Block if the hostname resolves to ANY private address (defends
    // against DNS-rebinding to an internal target)
    return addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false; // resolution failure → block
  }
}

// Enables request interception on a page and blocks internal-network
// requests. Call before setContent.
export async function guardPageRequests(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    void isSafeResourceUrl(request.url()).then(
      (safe) => {
        const action = safe ? request.continue() : request.abort();
        void action.catch(() => {});
      },
      () => void request.abort().catch(() => {})
    );
  });
}
