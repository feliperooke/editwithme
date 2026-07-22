import * as Y from "yjs";
import { randomUUID } from "node:crypto";
import {
  getObjectStore,
  PreconditionFailedError,
} from "@/lib/storage/objectStore";
import { loadYdoc, ydocToHtml } from "@/lib/materialize";

// Bucket layout (works identically on GCS and on the local driver):
//   docs/{id}/doc.json        — metadata + edit token
//   docs/{id}/snapshot.yjs    — compacted Yjs state
//   docs/{id}/log/{ts}-{r}.yjs — appended CRDT updates (immutable)
//
// Appends are new objects (race-free by construction — CRDT updates are
// commutative). Compaction merges log into a new snapshot guarded by a
// generation precondition and deletes exactly the log objects it
// included; a losing concurrent compactor simply aborts.

const COMPACT_THRESHOLD = 8;
const CAS_RETRIES = 3;

export interface DocMeta {
  id: string;
  title: string;
  headHtml: string | null;
  bodyAttrs: string | null;
  editToken: string;
  createdAt: string;
  updatedAt: string;
}

const metaPath = (id: string) => `docs/${id}/doc.json`;
const snapshotPath = (id: string) => `docs/${id}/snapshot.yjs`;
const logPrefix = (id: string) => `docs/${id}/log/`;

const logName = (id: string) =>
  `${logPrefix(id)}${Date.now().toString().padStart(15, "0")}-${randomUUID().slice(0, 8)}.yjs`;

async function readMeta(id: string): Promise<DocMeta | null> {
  const object = await getObjectStore().get(metaPath(id));
  if (!object) return null;
  try {
    return JSON.parse(object.data.toString("utf8")) as DocMeta;
  } catch {
    return null;
  }
}

async function casUpdateMeta(
  id: string,
  mutate: (meta: DocMeta) => DocMeta
): Promise<DocMeta | null> {
  const store = getObjectStore();
  for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
    const object = await store.get(metaPath(id));
    if (!object) return null;
    const meta = JSON.parse(object.data.toString("utf8")) as DocMeta;
    const updated = mutate(meta);
    try {
      await store.put(metaPath(id), Buffer.from(JSON.stringify(updated)), {
        ifGenerationMatch: object.generation,
      });
      return updated;
    } catch (error) {
      if (!(error instanceof PreconditionFailedError)) throw error;
    }
  }
  throw new PreconditionFailedError(metaPath(id));
}

export async function listDocMetas(): Promise<DocMeta[]> {
  const store = getObjectStore();
  const names = await store.list("docs/");
  const ids = [...new Set(names.map((n) => n.split("/")[1]).filter(Boolean))];
  const metas = await Promise.all(ids.map((id) => readMeta(id)));
  return (metas.filter(Boolean) as DocMeta[]).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

export async function getDocMeta(id: string): Promise<DocMeta | null> {
  return readMeta(id);
}

export async function createDoc(input: {
  id?: string;
  title: string;
  html: string;
  headHtml?: string | null;
  bodyAttrs?: string | null;
  editToken?: string | null;
}): Promise<DocMeta> {
  const store = getObjectStore();
  const id = input.id ?? randomUUID();
  const now = new Date().toISOString();
  const meta: DocMeta = {
    id,
    title: input.title,
    headHtml: input.headHtml ?? null,
    bodyAttrs: input.bodyAttrs ?? null,
    editToken: input.editToken || randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  // "Create only if absent": a concurrent creator loses cleanly
  await store.put(metaPath(id), Buffer.from(JSON.stringify(meta)), {
    ifGenerationMatch: "0",
  });
  if (input.html) {
    const seeded = loadYdoc(null, input.html);
    await store.put(
      snapshotPath(id),
      Buffer.from(Y.encodeStateAsUpdate(seeded)),
      { ifGenerationMatch: "0" }
    );
  }
  return meta;
}

export async function updateDocMeta(
  id: string,
  fields: Partial<Pick<DocMeta, "title" | "headHtml">>
): Promise<DocMeta | null> {
  return casUpdateMeta(id, (meta) => ({
    ...meta,
    ...fields,
    updatedAt: new Date().toISOString(),
  }));
}

export async function deleteDoc(id: string): Promise<void> {
  const store = getObjectStore();
  const names = await store.list(`docs/${id}/`);
  await Promise.all(names.map((name) => store.delete(name)));
}

// Merges snapshot + log tail into a live Y.Doc (merge-on-read: cheap
// because the log is pruned by compaction).
export async function readDocState(id: string): Promise<Y.Doc> {
  const store = getObjectStore();
  const ydoc = new Y.Doc();
  const snapshot = await store.get(snapshotPath(id));
  if (snapshot) Y.applyUpdate(ydoc, new Uint8Array(snapshot.data));
  const logNames = await store.list(logPrefix(id));
  for (const name of logNames) {
    const entry = await store.get(name);
    if (entry) Y.applyUpdate(ydoc, new Uint8Array(entry.data));
  }
  return ydoc;
}

export async function getDocHtml(id: string): Promise<string> {
  const ydoc = await readDocState(id);
  return ydocToHtml(ydoc);
}

export async function appendDocUpdate(
  id: string,
  update: Uint8Array
): Promise<void> {
  const store = getObjectStore();
  await store.put(logName(id), Buffer.from(update));
  await casUpdateMeta(id, (meta) => ({
    ...meta,
    updatedAt: new Date().toISOString(),
  })).catch(() => {
    // Metadata bump is best-effort; the update itself is durable
  });
  const logNames = await store.list(logPrefix(id));
  if (logNames.length >= COMPACT_THRESHOLD) {
    await compactDoc(id, logNames).catch(() => {
      // A concurrent compactor won; our log entries remain until next run
    });
  }
}

async function compactDoc(id: string, logNames: string[]): Promise<void> {
  const store = getObjectStore();
  const snapshot = await store.get(snapshotPath(id));
  const ydoc = new Y.Doc();
  if (snapshot) Y.applyUpdate(ydoc, new Uint8Array(snapshot.data));
  const included: string[] = [];
  for (const name of logNames) {
    const entry = await store.get(name);
    if (entry) {
      Y.applyUpdate(ydoc, new Uint8Array(entry.data));
      included.push(name);
    }
  }
  // Generation precondition: if another compactor swapped the snapshot
  // meanwhile, this throws and we delete nothing
  await store.put(
    snapshotPath(id),
    Buffer.from(Y.encodeStateAsUpdate(ydoc)),
    { ifGenerationMatch: snapshot?.generation ?? "0" }
  );
  await Promise.all(included.map((name) => store.delete(name)));
}
