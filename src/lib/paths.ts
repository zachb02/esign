import os from 'node:os';
import path from 'node:path';

export function getAppDataDir(): string {
  const override = process.env.ESIGN_DATA_DIR;
  if (override) return override;
  return path.join(os.homedir(), 'Library', 'Application Support', 'esign-app');
}

export function getDocumentsDir(): string {
  return path.join(getAppDataDir(), 'documents');
}

export function getThumbnailsDir(): string {
  return path.join(getAppDataDir(), 'thumbnails');
}

export function getSignaturesDir(): string {
  return path.join(getAppDataDir(), 'signatures');
}
