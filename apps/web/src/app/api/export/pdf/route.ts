import { NextResponse } from "next/server";
import { getBrowser } from "@/lib/serverBrowser";
import { guardPageRequests } from "@/lib/ssrfGuard";

// Cap the input so a huge document can't tie up the render (DoS)
const MAX_HTML_BYTES = 12 * 1024 * 1024; // 12 MB

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.html !== "string") {
    return NextResponse.json({ error: "html is required" }, { status: 400 });
  }
  if (Buffer.byteLength(body.html, "utf8") > MAX_HTML_BYTES) {
    return NextResponse.json({ error: "document too large" }, { status: 413 });
  }

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Block internal-network requests (SSRF) while letting public
    // fonts/images/CDNs load — the PDF renders as in the browser.
    await guardPageRequests(page);
    // Waits for external fonts/images to load before rendering, so the
    // PDF matches the document as seen in the browser (best effort)
    await page.setContent(body.html, { waitUntil: "load", timeout: 30_000 });
    await page
      .waitForNetworkIdle({ idleTime: 300, timeout: 10_000 })
      .catch(() => {});
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "15mm", bottom: "15mm", left: "12mm", right: "12mm" },
    });
    return new NextResponse(Buffer.from(pdf), {
      headers: { "Content-Type": "application/pdf" },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 }
    );
  } finally {
    await page.close().catch(() => {});
  }
}
