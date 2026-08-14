import { LocalFsStorageAdapter } from './local-fs-storage-adapter';
import { getDocumentsDir, getThumbnailsDir, getSignaturesDir } from '@/lib/paths';
import type { StorageAdapter } from './storage-adapter';

let documentStorage: StorageAdapter | null = null;
let thumbnailStorage: StorageAdapter | null = null;
let signatureStorage: StorageAdapter | null = null;

export function getDocumentStorage(): StorageAdapter {
  if (!documentStorage) {
    documentStorage = new LocalFsStorageAdapter(getDocumentsDir());
  }
  return documentStorage;
}

export function getThumbnailStorage(): StorageAdapter {
  if (!thumbnailStorage) {
    thumbnailStorage = new LocalFsStorageAdapter(getThumbnailsDir());
  }
  return thumbnailStorage;
}

export function getSignatureStorage(): StorageAdapter {
  if (!signatureStorage) {
    signatureStorage = new LocalFsStorageAdapter(getSignaturesDir());
  }
  return signatureStorage;
}

export type { StorageAdapter } from './storage-adapter';
