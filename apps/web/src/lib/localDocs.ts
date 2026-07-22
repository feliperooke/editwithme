// Registry of documents created instantly on this device (before the
// collab server knows them). Entries are pruned once the server lists
// the document; the stored key is the edit capability for the link.

export interface LocalDocEntry {
  id: string;
  key: string;
  title: string;
  createdAt: string;
}

const STORAGE_KEY = "html-docs-local";

export function listLocalDocs(): LocalDocEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LocalDocEntry[]) : [];
  } catch {
    return [];
  }
}

function save(entries: LocalDocEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // best-effort registry
  }
}

export function addLocalDoc(entry: LocalDocEntry) {
  save([entry, ...listLocalDocs().filter((e) => e.id !== entry.id)]);
}

export function removeLocalDoc(id: string) {
  save(listLocalDocs().filter((e) => e.id !== id));
}

export function updateLocalDocTitle(id: string, title: string) {
  save(
    listLocalDocs().map((e) => (e.id === id ? { ...e, title } : e))
  );
}
