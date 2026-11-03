import vscode from 'vscode';
import { InMemoryMemento } from '../../../test/integration/test_infrastructure/in_memory_memento';
import { createFakePartial } from '../../common/test_utils/create_fake_partial';
import {
  VIEWED_FILE_ID_QUERY_KEY,
  VIEWED_HASH_QUERY_KEY,
  VIEWED_MR_KEY_QUERY_KEY,
} from '../constants';
import { ViewedDecorationProvider } from './viewed_decoration_provider';
import { viewedFilesStore } from './viewed_files_store';

const MR_KEY = 'https://gitlab.com|9999|2000';
const FILE_ID = 'src/file.js';
const HASH = 'abc123';

const createUri = (hash = HASH) =>
  vscode.Uri.file(`/${FILE_ID}`).with({
    query: new URLSearchParams([
      [VIEWED_MR_KEY_QUERY_KEY, MR_KEY],
      [VIEWED_FILE_ID_QUERY_KEY, FILE_ID],
      [VIEWED_HASH_QUERY_KEY, hash],
    ]).toString(),
  });

describe('ViewedDecorationProvider', () => {
  let provider: ViewedDecorationProvider;

  beforeEach(() => {
    viewedFilesStore.init(
      createFakePartial<vscode.ExtensionContext>({ globalState: new InMemoryMemento() }),
    );
    provider = new ViewedDecorationProvider();
  });

  it('returns no decoration when the file is not viewed', () => {
    expect(provider.provideFileDecoration(createUri())).toBe(undefined);
  });

  it('returns a decoration when the file is viewed', async () => {
    await viewedFilesStore.setViewed(MR_KEY, FILE_ID, HASH);

    expect(provider.provideFileDecoration(createUri())).toEqual({
      color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),
      tooltip: 'Viewed',
    });
  });

  it('returns no decoration when the viewed state is stale (file changed)', async () => {
    await viewedFilesStore.setViewed(MR_KEY, FILE_ID, HASH);

    expect(provider.provideFileDecoration(createUri('new-hash'))).toBe(undefined);
  });

  it('returns no decoration for URIs without viewed query params', () => {
    expect(provider.provideFileDecoration(vscode.Uri.file(`/${FILE_ID}`))).toBe(undefined);
  });

  it('returns no decoration for non-file URIs', async () => {
    await viewedFilesStore.setViewed(MR_KEY, FILE_ID, HASH);

    expect(provider.provideFileDecoration(createUri().with({ scheme: 'gl-review' }))).toBe(
      undefined,
    );
  });

  it('notifies listeners when fireChange is called', () => {
    const listener = jest.fn();
    provider.onDidChangeFileDecorations(listener);
    const uri = createUri();

    provider.fireChange(uri);

    expect(listener).toHaveBeenCalledWith(uri);
  });
});
