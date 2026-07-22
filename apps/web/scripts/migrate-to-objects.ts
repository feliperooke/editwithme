// Copies every document from SQLite into the object store (local dir or
// GCS, depending on env). Run from apps/web:
//   pnpm tsx scripts/migrate-to-objects.ts
import * as Y from "yjs";
import { getDocument, listDocuments } from "@html-editor/db";
import { getObjectStore } from "../src/lib/storage/objectStore";
import { createDoc } from "../src/lib/storage/docStore";
import { loadYdoc } from "../src/lib/materialize";

async function main() {
const store = getObjectStore();
const docs = listDocuments();
for (const summary of docs) {
  const doc = getDocument(summary.id);
  if (!doc) continue;
  const existing = await store.get(`docs/${doc.id}/doc.json`);
  if (existing) {
    console.log(`skip ${doc.id} (already migrated)`);
    continue;
  }
  await createDoc({
    id: doc.id,
    title: doc.title,
    html: "",
    headHtml: doc.headHtml,
    bodyAttrs: doc.bodyAttrs,
    editToken: doc.editToken,
  });
  const ydoc = loadYdoc(doc.ydoc ? new Uint8Array(doc.ydoc) : null, doc.html);
  await store.put(
    `docs/${doc.id}/snapshot.yjs`,
    Buffer.from(Y.encodeStateAsUpdate(ydoc))
  );
  console.log(`migrated ${doc.id} (${doc.title})`);
}
console.log(`done: ${docs.length} document(s)`);
}

void main();
