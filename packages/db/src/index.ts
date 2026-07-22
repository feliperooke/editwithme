import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface DocumentSummary {
  id: string;
  title: string;
  editToken: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRecord extends DocumentSummary {
  html: string;
  headHtml: string | null;
  bodyAttrs: string | null;
  ydoc: Buffer | null;
}

interface DocumentRow {
  id: string;
  title: string;
  edit_token: string | null;
  html: string;
  head_html: string | null;
  body_attrs: string | null;
  ydoc: Buffer | null;
  created_at: string;
  updated_at: string;
}

function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

function openDatabase(): Database.Database {
  const dbPath =
    process.env.DATABASE_PATH ??
    path.join(findWorkspaceRoot(process.cwd()), "data", "documents.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  // Web and collab open the same file from separate processes
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      html TEXT NOT NULL DEFAULT '',
      head_html TEXT,
      body_attrs TEXT,
      ydoc BLOB,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  // Migration for databases created before the style columns existed
  const columns = (
    db.prepare("PRAGMA table_info(documents)").all() as { name: string }[]
  ).map((c) => c.name);
  if (!columns.includes("head_html")) {
    db.exec("ALTER TABLE documents ADD COLUMN head_html TEXT");
  }
  if (!columns.includes("body_attrs")) {
    db.exec("ALTER TABLE documents ADD COLUMN body_attrs TEXT");
  }
  // Edit capability token: knowing the doc id grants read access only;
  // writing requires this token (checked by the collab server)
  if (!columns.includes("edit_token")) {
    db.exec("ALTER TABLE documents ADD COLUMN edit_token TEXT");
  }
  const missingToken = db
    .prepare("SELECT id FROM documents WHERE edit_token IS NULL")
    .all() as { id: string }[];
  const setToken = db.prepare(
    "UPDATE documents SET edit_token = ? WHERE id = ?"
  );
  for (const row of missingToken) setToken.run(randomUUID(), row.id);
  return db;
}

// Global cache so the connection survives Next HMR in development.
// Lazy opening: the Next build imports route modules without executing
// them, and opening the database at import time causes contention
// between build workers.
const globalForDb = globalThis as unknown as {
  __htmlEditorDb?: Database.Database;
};

function db(): Database.Database {
  return (globalForDb.__htmlEditorDb ??= openDatabase());
}

function toSummary(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    title: row.title,
    editToken: row.edit_token ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listDocuments(): DocumentSummary[] {
  const rows = db()
    .prepare(
      "SELECT id, title, html, ydoc, edit_token, created_at, updated_at FROM documents ORDER BY updated_at DESC"
    )
    .all() as DocumentRow[];
  return rows.map(toSummary);
}

export function getDocument(id: string): DocumentRecord | null {
  const row = db()
    .prepare("SELECT * FROM documents WHERE id = ?")
    .get(id) as DocumentRow | undefined;
  if (!row) return null;
  return {
    ...toSummary(row),
    html: row.html,
    headHtml: row.head_html ?? null,
    bodyAttrs: row.body_attrs ?? null,
    ydoc: row.ydoc ?? null,
  };
}

export function createDocument(input: {
  id?: string;
  title: string;
  html: string;
  headHtml?: string | null;
  bodyAttrs?: string | null;
  editToken?: string | null;
}): DocumentRecord {
  const id = input.id ?? randomUUID();
  const now = new Date().toISOString();
  db().prepare(
    "INSERT INTO documents (id, title, html, head_html, body_attrs, edit_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    input.title,
    input.html,
    input.headHtml ?? null,
    input.bodyAttrs ?? null,
    input.editToken || randomUUID(),
    now,
    now
  );
  return getDocument(id)!;
}

export function updateDocumentTitle(
  id: string,
  title: string
): DocumentRecord | null {
  db().prepare("UPDATE documents SET title = ?, updated_at = ? WHERE id = ?").run(
    title,
    new Date().toISOString(),
    id
  );
  return getDocument(id);
}

export function updateDocumentHead(
  id: string,
  headHtml: string
): DocumentRecord | null {
  db().prepare(
    "UPDATE documents SET head_html = ?, updated_at = ? WHERE id = ?"
  ).run(headHtml, new Date().toISOString(), id);
  return getDocument(id);
}

export function updateDocumentContent(
  id: string,
  html: string,
  ydoc: Buffer
): void {
  db().prepare(
    "UPDATE documents SET html = ?, ydoc = ?, updated_at = ? WHERE id = ?"
  ).run(html, ydoc, new Date().toISOString(), id);
}

export function deleteDocument(id: string): boolean {
  return db().prepare("DELETE FROM documents WHERE id = ?").run(id).changes > 0;
}
