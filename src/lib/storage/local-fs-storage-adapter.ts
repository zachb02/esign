import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { StorageAdapter } from './storage-adapter';

export class LocalFsStorageAdapter implements StorageAdapter {
  constructor(private readonly rootDir: string) {}

  private resolveKeyPath(key: string): string {
    const normalized = path.normalize(key);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return path.join(this.rootDir, normalized);
  }

  async save(key: string, data: Buffer): Promise<void> {
    const filePath = this.resolveKeyPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(this.resolveKeyPath(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolveKeyPath(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolveKeyPath(key));
      return true;
    } catch {
      return false;
    }
  }
}
