import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';

interface IndexedFileEntry {
  mtimeMs: number;
  size: number;
  terms: string[];
}

interface PersistedWorkspaceIndexShape {
  version: number;
  workspaces: Record<string, Record<string, IndexedFileEntry>>;
}

export interface WorkspaceFileSnapshot {
  uri: vscode.Uri;
  mtimeMs: number;
  size: number;
}

export interface WorkspaceIndexEntry {
  fileUri: string;
  mtimeMs: number;
  size: number;
  terms: string[];
}

const INDEX_FILE_NAME = 'workspace-identifier-index.json';
const INDEX_STATE_VERSION = 1;

export class WorkspaceIndexStore {
  private readonly workspaces = new Map<string, Map<string, IndexedFileEntry>>();
  private initialized = false;

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const indexPath = this.getIndexFilePath();
    await fs.mkdir(path.dirname(indexPath), { recursive: true });

    try {
      const raw = await fs.readFile(indexPath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedWorkspaceIndexShape;
      if (parsed.version !== INDEX_STATE_VERSION || !parsed.workspaces) {
        this.initialized = true;
        return;
      }

      for (const [workspaceKey, files] of Object.entries(parsed.workspaces)) {
        const fileMap = new Map<string, IndexedFileEntry>();
        for (const [fileUri, entry] of Object.entries(files)) {
          if (!entry || !Array.isArray(entry.terms)) {
            continue;
          }
          fileMap.set(fileUri, {
            mtimeMs: Number(entry.mtimeMs) || 0,
            size: Number(entry.size) || 0,
            terms: Array.from(new Set(entry.terms.filter(Boolean))),
          });
        }
        this.workspaces.set(workspaceKey, fileMap);
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOENT') {
        throw error;
      }
    }

    this.initialized = true;
  }

  public getWorkspaceEntries(workspaceKey: string): WorkspaceIndexEntry[] {
    const fileMap = this.workspaces.get(workspaceKey);
    if (!fileMap) {
      return [];
    }

    return Array.from(fileMap.entries()).map(([fileUri, entry]) => ({
      fileUri,
      mtimeMs: entry.mtimeMs,
      size: entry.size,
      terms: [...entry.terms],
    }));
  }

  public getWorkspaceTermSet(workspaceKey: string): Set<string> {
    const terms = new Set<string>();
    const fileMap = this.workspaces.get(workspaceKey);
    if (!fileMap) {
      return terms;
    }

    for (const entry of fileMap.values()) {
      for (const term of entry.terms) {
        terms.add(term);
      }
    }
    return terms;
  }

  public getChangedSnapshots(
    workspaceKey: string,
    snapshots: WorkspaceFileSnapshot[],
  ): WorkspaceFileSnapshot[] {
    const fileMap = this.workspaces.get(workspaceKey);
    if (!fileMap) {
      return snapshots;
    }

    const changed: WorkspaceFileSnapshot[] = [];
    for (const snapshot of snapshots) {
      const fileUri = snapshot.uri.toString();
      const existing = fileMap.get(fileUri);
      if (
        !existing ||
        existing.mtimeMs !== snapshot.mtimeMs ||
        existing.size !== snapshot.size
      ) {
        changed.push(snapshot);
      }
    }
    return changed;
  }

  public upsertFile(
    workspaceKey: string,
    fileUri: string,
    mtimeMs: number,
    size: number,
    terms: string[],
  ): void {
    const fileMap = this.ensureWorkspace(workspaceKey);
    fileMap.set(fileUri, {
      mtimeMs,
      size,
      terms: Array.from(new Set(terms.filter(Boolean))),
    });
  }

  public removeMissingFiles(
    workspaceKey: string,
    existingFileUris: Set<string>,
  ): void {
    const fileMap = this.workspaces.get(workspaceKey);
    if (!fileMap) {
      return;
    }

    for (const fileUri of Array.from(fileMap.keys())) {
      if (!existingFileUris.has(fileUri)) {
        fileMap.delete(fileUri);
      }
    }
  }

  public async flush(): Promise<void> {
    await this.init();

    const workspaces: Record<string, Record<string, IndexedFileEntry>> = {};
    for (const [workspaceKey, fileMap] of this.workspaces.entries()) {
      workspaces[workspaceKey] = {};
      for (const [fileUri, entry] of fileMap.entries()) {
        workspaces[workspaceKey][fileUri] = {
          mtimeMs: entry.mtimeMs,
          size: entry.size,
          terms: [...entry.terms],
        };
      }
    }

    const payload: PersistedWorkspaceIndexShape = {
      version: INDEX_STATE_VERSION,
      workspaces,
    };
    await fs.writeFile(this.getIndexFilePath(), JSON.stringify(payload, null, 2), 'utf8');
  }

  public async clear(): Promise<void> {
    this.workspaces.clear();
    await this.flush();
  }

  private ensureWorkspace(workspaceKey: string): Map<string, IndexedFileEntry> {
    let fileMap = this.workspaces.get(workspaceKey);
    if (!fileMap) {
      fileMap = new Map<string, IndexedFileEntry>();
      this.workspaces.set(workspaceKey, fileMap);
    }
    return fileMap;
  }

  private getIndexFilePath(): string {
    return path.join(this.context.globalStorageUri.fsPath, INDEX_FILE_NAME);
  }
}
