import vscode from 'vscode';
import { InMemoryMemento } from '../../../test/integration/test_infrastructure/in_memory_memento';
import { createFakePartial } from '../../common/test_utils/create_fake_partial';
import { diffFile } from '../test_utils/entities';
import {
  getFileContentHash,
  getMrKey,
  ViewedFilesStoreImpl,
  ViewedFilesStore,
} from './viewed_files_store';

const MR_KEY = getMrKey('https://gitlab.com', 9999, 2000);
const OTHER_MR_KEY = getMrKey('https://gitlab.com', 9999, 3000);
const OTHER_INSTANCE_MR_KEY = getMrKey('https://example.com', 9999, 2000);
const FILE_ID = 'src/file.js';
const HASH = 'abc123';

describe('viewedFilesStore', () => {
  let store: ViewedFilesStore;

  beforeEach(() => {
    store = new ViewedFilesStoreImpl();
    store.init(createFakePartial<vscode.ExtensionContext>({ globalState: new InMemoryMemento() }));
  });

  it('reports file as not viewed by default', () => {
    expect(store.isViewed(MR_KEY, FILE_ID, HASH)).toBe(false);
  });

  it('reports file as viewed after setViewed', async () => {
    await store.setViewed(MR_KEY, FILE_ID, HASH);

    expect(store.isViewed(MR_KEY, FILE_ID, HASH)).toBe(true);
  });

  it('reports file as not viewed after setNotViewed', async () => {
    await store.setViewed(MR_KEY, FILE_ID, HASH);
    await store.setNotViewed(MR_KEY, FILE_ID);

    expect(store.isViewed(MR_KEY, FILE_ID, HASH)).toBe(false);
  });

  it('does nothing when un-viewing a file in an unknown MR', async () => {
    await store.setNotViewed(MR_KEY, FILE_ID);

    expect(store.isViewed(MR_KEY, FILE_ID, HASH)).toBe(false);
  });

  it('drops the MR entry when its last viewed file is un-viewed', async () => {
    jest.useFakeTimers();
    try {
      for (let i = 0; i < 99; i += 1) {
        jest.advanceTimersByTime(1000);
        // eslint-disable-next-line no-await-in-loop
        await store.setViewed(getMrKey('https://gitlab.com', 9999, i), FILE_ID, HASH);
      }

      // the emptied MR must not occupy a slot of the pruning cap, even as the most recent entry
      jest.advanceTimersByTime(1000);
      await store.setViewed(MR_KEY, FILE_ID, HASH);
      await store.setNotViewed(MR_KEY, FILE_ID);

      jest.advanceTimersByTime(1000);
      await store.setViewed(getMrKey('https://gitlab.com', 9999, 99), FILE_ID, HASH);

      expect(store.isViewed(getMrKey('https://gitlab.com', 9999, 0), FILE_ID, HASH)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports file as not viewed when the content hash changed (new push)', async () => {
    await store.setViewed(MR_KEY, FILE_ID, HASH);

    expect(store.isViewed(MR_KEY, FILE_ID, 'different-hash')).toBe(false);
  });

  it('keeps viewed state isolated between MRs', async () => {
    await store.setViewed(MR_KEY, FILE_ID, HASH);

    expect(store.isViewed(OTHER_MR_KEY, FILE_ID, HASH)).toBe(false);
  });

  it('keeps viewed state isolated between instances', async () => {
    await store.setViewed(MR_KEY, FILE_ID, HASH);

    expect(store.isViewed(OTHER_INSTANCE_MR_KEY, FILE_ID, HASH)).toBe(false);
  });

  it('keeps only the 100 most recently updated MRs', async () => {
    jest.useFakeTimers();
    try {
      await store.setViewed(MR_KEY, FILE_ID, HASH);
      for (let i = 0; i < 100; i += 1) {
        jest.advanceTimersByTime(1000);
        // eslint-disable-next-line no-await-in-loop
        await store.setViewed(getMrKey('https://gitlab.com', 9999, i), FILE_ID, HASH);
      }

      expect(store.isViewed(MR_KEY, FILE_ID, HASH)).toBe(false);
      expect(store.isViewed(getMrKey('https://gitlab.com', 9999, 99), FILE_ID, HASH)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('getMrKey', () => {
    it('combines instance, project and MR ids', () => {
      expect(getMrKey('https://gitlab.com', 1, 2)).toBe('https://gitlab.com|1|2');
    });
  });

  describe('getFileContentHash', () => {
    it('is stable for the same file content', () => {
      expect(getFileContentHash(diffFile)).toBe(getFileContentHash({ ...diffFile }));
    });

    it('changes when the diff changes', () => {
      expect(getFileContentHash(diffFile)).not.toBe(
        getFileContentHash({ ...diffFile, diff: 'other diff' }),
      );
    });

    it('changes when the file is renamed', () => {
      expect(getFileContentHash(diffFile)).not.toBe(
        getFileContentHash({ ...diffFile, old_path: 'renamed.js' }),
      );
    });
  });
});
