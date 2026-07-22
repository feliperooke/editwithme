import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Cloud Run container
  output: "standalone",
  transpilePackages: ["@html-editor/db", "@html-editor/editor-schema"],
  // happy-dom/transformer/yjs must NOT be bundled server-side: bundling
  // creates a second Yjs instance and its constructor checks break the
  // Y.Doc handoff to @hocuspocus/transformer (materialize.ts)
  serverExternalPackages: [
    "better-sqlite3",
    "puppeteer",
    "@google-cloud/storage",
    "happy-dom",
    "jsdom",
    "@hocuspocus/transformer",
    "@tiptap/html",
    "yjs",
  ],
};

export default nextConfig;
