import * as vscode from 'vscode';
import { getSidebarViewState, setSidebarViewState, SidebarViewState } from './sidebar_view_state';

describe('review sidebar view', () => {
  it('defaults to a directory tree', () => {
    expect(getSidebarViewState()).toBe(SidebarViewState.TreeView);
  });

  it('still allows switching to a list and back to a tree', async () => {
    await setSidebarViewState(SidebarViewState.ListView);
    expect(getSidebarViewState()).toBe(SidebarViewState.ListView);
    await setSidebarViewState(SidebarViewState.TreeView);
    expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith(
      'setContext',
      'gitlab.sidebarView',
      'tree',
    );
  });
});
