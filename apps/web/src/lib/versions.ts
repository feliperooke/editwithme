import { getObjectStore } from "@/lib/storage/objectStore";

// Automatic document version history. Versions are point-in-time HTML
// snapshots stored next to the document's CRDT objects:
//   docs/{id}/versions/{millis, zero-padded}.json  ->  { at, html }
// Capture is throttled: a new version lands on the first content
// change after VERSION_INTERVAL_MS since the previous one, so bursts
// of edits collapse into one version (Google-Docs-like sessions).

const VERSION_INTERVAL_MS = 3 * 60 * 1000;
const PAD = 15; // lexicographic order == chronological order

export interface VersionEntry {
  at: number;
  size: number;
}

const prefix = (id: string) => `docs/${id}/versions/`;
const nameFor = (id: string, at: number) =>
  `${prefix(id)}${String(at).padStart(PAD, "0")}.json`;
const atFromName = (name: string): number =>
  Number(name.split("/").pop()!.replace(".json", ""));

// In-process memo of the latest capture per doc: avoids a store LIST on
// every checkpoint push. Cold starts just pay one list to warm it.
const lastCapture = new Map<string, number>();

async function latestAt(id: string): Promise<number | null> {
  const memo = lastCapture.get(id);
  if (memo) return memo;
  const names = await getObjectStore().list(prefix(id));
  if (names.length === 0) return null;
  const at = atFromName(names.sort()[names.length - 1]);
  lastCapture.set(id, at);
  return at;
}

// Called after content-changing writes. `html` is lazy so callers only
// materialize the document when a capture is actually due.
export async function captureVersionIfDue(
  id: string,
  html: () => string | Promise<string>
): Promise<void> {
  try {
    const last = await latestAt(id);
    const now = Date.now();
    if (last && now - last < VERSION_INTERVAL_MS) return;
    const content = await html();
    if (!content.trim()) return;
    if (last) {
      const previous = await getObjectStore().get(nameFor(id, last));
      if (previous) {
        const parsed = JSON.parse(previous.data.toString("utf8"));
        if (parsed.html === content) return; // no change since last version
      }
    }
    await getObjectStore().put(
      nameFor(id, now),
      Buffer.from(JSON.stringify({ at: now, html: content })),
      undefined
    );
    lastCapture.set(id, now);
  } catch {
    // Version capture is best-effort: never fail the write that triggered it
  }
}

export async function listVersions(id: string): Promise<VersionEntry[]> {
  const store = getObjectStore();
  const names = (await store.list(prefix(id))).sort().reverse();
  const entries: VersionEntry[] = [];
  for (const name of names) {
    const obj = await store.get(name);
    if (obj) entries.push({ at: atFromName(name), size: obj.data.length });
  }
  return entries;
}

export async function readVersion(
  id: string,
  at: number
): Promise<{ at: number; html: string } | null> {
  const obj = await getObjectStore().get(nameFor(id, at));
  if (!obj) return null;
  return JSON.parse(obj.data.toString("utf8"));
}

// Deletes every version NEWER than `at` — the "future history" being
// replaced when the user restores an old version.
export async function dropVersionsAfter(id: string, at: number): Promise<void> {
  const store = getObjectStore();
  const names = await store.list(prefix(id));
  for (const name of names) {
    if (atFromName(name) > at) await store.delete(name);
  }
  lastCapture.delete(id);
}
