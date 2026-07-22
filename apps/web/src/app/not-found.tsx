import Link from "next/link";

export default function NotFound() {
  return (
    <div className="editor-loading">
      <p>Page not found.</p>
      <Link href="/" className="error-retry">
        Create a new document
      </Link>
    </div>
  );
}
