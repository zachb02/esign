import { describe, expect, it, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { getAppDataDir, getDocumentsDir, getThumbnailsDir } from './paths';

describe('paths', () => {
  afterEach(() => {
    delete process.env.ESIGN_DATA_DIR;
  });

  it('defaults to the macOS Application Support directory', () => {
    expect(getAppDataDir()).toBe(
      path.join(os.homedir(), 'Library', 'Application Support', 'esign-app')
    );
  });

  it('respects an ESIGN_DATA_DIR override', () => {
    process.env.ESIGN_DATA_DIR = '/tmp/esign-test-override';
    expect(getAppDataDir()).toBe('/tmp/esign-test-override');
  });

  it('nests documents and thumbnails under the app data dir', () => {
    process.env.ESIGN_DATA_DIR = '/tmp/esign-test-override';
    expect(getDocumentsDir()).toBe('/tmp/esign-test-override/documents');
    expect(getThumbnailsDir()).toBe('/tmp/esign-test-override/thumbnails');
  });
});
