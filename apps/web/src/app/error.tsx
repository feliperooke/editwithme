"use client";

// Route-level error boundary: shown instead of the crashed page.
// Local edits are safe in IndexedDB — reloading never loses work.
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="editor-loading">
      <p>Something went wrong.</p>
      <button type="button" className="error-retry" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
