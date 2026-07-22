import * as Y from "yjs";
import {
  createDocument as sqliteCreate,
  deleteDocument as sqliteDelete,
  getDocument as sqliteGet,
  updateDocumentContent as sqliteUpdateContent,
  updateDocumentHead as sqliteUpdateHead,
  updateDocumentTitle as sqliteUpdateTitle,
} from "@html-editor/db";
import {
  appendDocUpdate,
  createDoc,
  deleteDoc,
  getDocHtml,
  getDocMeta,
  readDocState,
  updateDocMeta,
} from "@/lib/storage/docStore";
import { loadYdoc, replaceContentAsUpdate, ydocToHtml } from "@/lib/materialize";
import { captureVersionIfDue } from "@/lib/versions";

// Async data facade with two drivers:
// - "sqlite" (default): the original better-sqlite3 database
// - "objects": the GCS-style object store (bucket or local directory),
//   designed for the P2P/serverless deployment (append-only CRDT log)
// Route handlers only talk to this facade.

const driver =
  process.env.STORAGE_DRIVER === "objects" ? "objects" : "sqlite";

export interface DocRecord {
  id: string;
  title: string;
  editToken: string;
  headHtml: string | null;
  bodyAttrs: string | null;
  html: string;
  createdAt: string;
  updatedAt: string;
}

export type DocSummary = Omit<DocRecord, "html" | "headHtml" | "bodyAttrs">;

// No listDocumentsData: the capability model has no workspace-wide
// enumeration. Listing every document (and its edit key) was the
// primitive behind the removed admin MCP endpoint; it is intentionally
// absent so it can never be re-exposed by accident.

export async function getDocumentData(id: string): Promise<DocRecord | null> {
  if (driver === "sqlite") {
    const doc = sqliteGet(id);
    if (!doc) return null;
    const { ydoc: _ydoc, ...record } = doc;
    return record;
  }
  const meta = await getDocMeta(id);
  if (!meta) return null;
  return { ...meta, html: await getDocHtml(id) };
}

export async function createDocumentData(input: {
  id?: string;
  title: string;
  html: string;
  headHtml?: string | null;
  bodyAttrs?: string | null;
  editToken?: string | null;
}): Promise<DocRecord> {
  if (driver === "sqlite") {
    const doc = sqliteCreate(input);
    const { ydoc: _ydoc, ...record } = doc;
    return record;
  }
  const meta = await createDoc(input);
  return { ...meta, html: input.html };
}

export async function updateDocumentTitleData(
  id: string,
  title: string
): Promise<DocRecord | null> {
  if (driver === "sqlite") {
    const doc = sqliteUpdateTitle(id, title);
    if (!doc) return null;
    const { ydoc: _ydoc, ...record } = doc;
    return record;
  }
  const meta = await updateDocMeta(id, { title });
  return meta ? { ...meta, html: await getDocHtml(id) } : null;
}

export async function updateDocumentHeadData(
  id: string,
  headHtml: string
): Promise<DocRecord | null> {
  if (driver === "sqlite") {
    const doc = sqliteUpdateHead(id, headHtml);
    if (!doc) return null;
    const { ydoc: _ydoc, ...record } = doc;
    return record;
  }
  const meta = await updateDocMeta(id, { headHtml });
  return meta ? { ...meta, html: await getDocHtml(id) } : null;
}

export async function deleteDocumentData(id: string): Promise<void> {
  if (driver === "sqlite") {
    sqliteDelete(id);
    return;
  }
  await deleteDoc(id);
}

// ---------------------------------------------------------------------------
// Sync (P2P checkpoints)

export async function readSyncState(
  id: string
): Promise<{ ydoc: Y.Doc; exists: boolean }> {
  if (driver === "sqlite") {
    const doc = sqliteGet(id);
    if (!doc) return { ydoc: new Y.Doc(), exists: false };
    return {
      ydoc: loadYdoc(doc.ydoc ? new Uint8Array(doc.ydoc) : null, doc.html),
      exists: true,
    };
  }
  const meta = await getDocMeta(id);
  return { ydoc: await readDocState(id), exists: Boolean(meta) };
}

// Applies a leader checkpoint. Creates the document (adopting the key)
// when it does not exist. Returns the server state vector, or null when
// the key is invalid.
export async function appendSyncUpdate(
  id: string,
  update: Uint8Array,
  key: string
): Promise<Uint8Array | null> {
  if (driver === "sqlite") {
    let doc = sqliteGet(id);
    if (!doc) {
      doc = sqliteCreate({ id, title: "Untitled", html: "", editToken: key || null });
    }
    if (!key || key !== doc.editToken) return null;
    const ydoc = loadYdoc(doc.ydoc ? new Uint8Array(doc.ydoc) : null, doc.html);
    Y.applyUpdate(ydoc, update);
    const rendered = ydocToHtml(ydoc);
    sqliteUpdateContent(id, rendered, Buffer.from(Y.encodeStateAsUpdate(ydoc)));
    await captureVersionIfDue(id, () => rendered);
    return Y.encodeStateVector(ydoc);
  }

  let meta = await getDocMeta(id);
  if (!meta) {
    meta = await createDoc({
      id,
      title: "Untitled",
      html: "",
      editToken: key || null,
    });
  }
  if (!key || key !== meta.editToken) return null;
  await appendDocUpdate(id, update);
  const ydoc = await readDocState(id);
  await captureVersionIfDue(id, () => ydocToHtml(ydoc));
  return Y.encodeStateVector(ydoc);
}

// Replaces a document's content with new HTML (MCP / AI revisions).
// Requires the edit key; returns false when it does not match.
export async function replaceDocumentContent(
  id: string,
  html: string,
  key: string
): Promise<boolean> {
  if (driver === "sqlite") {
    const doc = sqliteGet(id);
    if (!doc || !key || key !== doc.editToken) return false;
    const ydoc = loadYdoc(doc.ydoc ? new Uint8Array(doc.ydoc) : null, doc.html);
    replaceContentAsUpdate(ydoc, html);
    const rendered = ydocToHtml(ydoc);
    sqliteUpdateContent(id, rendered, Buffer.from(Y.encodeStateAsUpdate(ydoc)));
    await captureVersionIfDue(id, () => rendered);
    return true;
  }
  const meta = await getDocMeta(id);
  if (!meta || !key || key !== meta.editToken) return false;
  const ydoc = await readDocState(id);
  const delta = replaceContentAsUpdate(ydoc, html);
  await appendDocUpdate(id, delta);
  await captureVersionIfDue(id, () => ydocToHtml(ydoc));
  return true;
}
