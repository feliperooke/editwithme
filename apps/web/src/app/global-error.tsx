"use client";

// Root error boundary: replaces the whole document when the root
// layout itself crashes, so it must render its own <html>/<body>.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", padding: "4rem", textAlign: "center" }}>
        <p>Something went wrong.</p>
        <button type="button" onClick={reset} style={{ marginTop: "1rem" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
