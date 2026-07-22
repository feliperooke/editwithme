import fs from "node:fs";
import path from "node:path";

// Object-store abstraction with GCS semantics: immutable objects,
// lexicographic prefix listing, and generation preconditions for
// compare-and-swap writes. Two drivers:
// - GcsObjectStore: real bucket (@google-cloud/storage); also works
//   against fake-gcs-server via STORAGE_EMULATOR_HOST.
// - LocalObjectStore: plain files under data/objects — same semantics,
//   zero dependencies, for development and tests.

export interface StoredObject {
  data: Buffer;
  generation: string;
}

export interface PutOptions {
  // "0" = create only if the object does not exist; any other value =
  // write only if the current generation matches (CAS)
  ifGenerationMatch?: string;
}

export interface ObjectStore {
  get(name: string): Promise<StoredObject | null>;
  put(name: string, data: Buffer, opts?: PutOptions): Promise<string>;
  delete(name: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export class PreconditionFailedError extends Error {
  constructor(name: string) {
    super(`precondition failed for object "${name}"`);
  }
}

// ---------------------------------------------------------------------------
// Local filesystem driver

function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

export class LocalObjectStore implements ObjectStore {
  private root: string;
  // Single-process CAS guard (the web server is the only writer)
  private locks = new Map<string, Promise<unknown>>();

  constructor(root?: string) {
    this.root =
      root ??
      process.env.OBJECTS_DIR ??
      path.join(findWorkspaceRoot(process.cwd()), "data", "objects");
  }

  private filePath(name: string) {
    const safe = name.split("/").filter((p) => p && p !== "..");
    return path.join(this.root, ...safe);
  }

  private genPath(name: string) {
    return `${this.filePath(name)}.gen`;
  }

  private async withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(name) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.locks.set(name, next.catch(() => {}));
    return next;
  }

  async get(name: string): Promise<StoredObject | null> {
    try {
      const data = await fs.promises.readFile(this.filePath(name));
      const generation = await fs.promises
        .readFile(this.genPath(name), "utf8")
        .catch(() => "1");
      return { data, generation: generation.trim() };
    } catch {
      return null;
    }
  }

  async put(name: string, data: Buffer, opts?: PutOptions): Promise<string> {
    return this.withLock(name, async () => {
      const current = await this.get(name);
      if (opts?.ifGenerationMatch !== undefined) {
        if (opts.ifGenerationMatch === "0") {
          if (current) throw new PreconditionFailedError(name);
        } else if (!current || current.generation !== opts.ifGenerationMatch) {
          throw new PreconditionFailedError(name);
        }
      }
      const generation = String(
        current ? Number(current.generation) + 1 : 1
      );
      const file = this.filePath(name);
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, data);
      await fs.promises.writeFile(this.genPath(name), generation);
      return generation;
    });
  }

  async delete(name: string): Promise<void> {
    await fs.promises.rm(this.filePath(name), { force: true });
    await fs.promises.rm(this.genPath(name), { force: true });
  }

  async list(prefix: string): Promise<string[]> {
    const results: string[] = [];
    const base = this.filePath(prefix.replace(/\/$/, ""));
    const walk = async (dir: string, rel: string) => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const relName = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(path.join(dir, entry.name), relName);
        } else if (!entry.name.endsWith(".gen")) {
          results.push(`${prefix.replace(/\/$/, "")}/${relName}`);
        }
      }
    };
    await walk(base, "");
    return results.sort();
  }
}

// ---------------------------------------------------------------------------
// GCS driver

class GcsObjectStore implements ObjectStore {
  // Lazy import keeps @google-cloud/storage out of the bundle path when
  // the local driver is in use
  private bucketPromise = (async () => {
    const { Storage } = await import("@google-cloud/storage");
    const storage = new Storage();
    return storage.bucket(process.env.GCS_BUCKET as string);
  })();

  async get(name: string): Promise<StoredObject | null> {
    const bucket = await this.bucketPromise;
    const file = bucket.file(name);
    try {
      const [metadata] = await file.getMetadata();
      const [data] = await file.download();
      return { data, generation: String(metadata.generation) };
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  async put(name: string, data: Buffer, opts?: PutOptions): Promise<string> {
    const bucket = await this.bucketPromise;
    const file = bucket.file(name);
    try {
      await file.save(data, {
        resumable: false,
        preconditionOpts:
          opts?.ifGenerationMatch !== undefined
            ? { ifGenerationMatch: Number(opts.ifGenerationMatch) }
            : undefined,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 412) {
        throw new PreconditionFailedError(name);
      }
      throw error;
    }
    const [metadata] = await file.getMetadata();
    return String(metadata.generation);
  }

  async delete(name: string): Promise<void> {
    const bucket = await this.bucketPromise;
    await bucket.file(name).delete({ ignoreNotFound: true });
  }

  async list(prefix: string): Promise<string[]> {
    const bucket = await this.bucketPromise;
    const [files] = await bucket.getFiles({ prefix });
    return files.map((f: { name: string }) => f.name).sort();
  }
}

// ---------------------------------------------------------------------------

const globalForStore = globalThis as unknown as {
  __objectStore?: ObjectStore;
};

export function getObjectStore(): ObjectStore {
  if (!globalForStore.__objectStore) {
    globalForStore.__objectStore = process.env.GCS_BUCKET
      ? new GcsObjectStore()
      : new LocalObjectStore();
  }
  return globalForStore.__objectStore;
}
