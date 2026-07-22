import puppeteer, { type Browser } from "puppeteer";

// Shared headless Chrome instance for PDF export
// (launch costs ~1s; rendering itself is fast).
const globalForBrowser = globalThis as unknown as {
  __headlessBrowser?: Promise<Browser>;
};

export async function getBrowser(): Promise<Browser> {
  const cached = globalForBrowser.__headlessBrowser;
  if (cached) {
    const browser = await cached.catch(() => null);
    if (browser?.connected) return browser;
  }
  globalForBrowser.__headlessBrowser = puppeteer.launch({
    headless: true,
    // In the container we use the system Chromium; Cloud Run has no
    // user namespaces, so the sandbox must be disabled there
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: process.env.CHROME_NO_SANDBOX
      ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
      : [],
  });
  return globalForBrowser.__headlessBrowser;
}
