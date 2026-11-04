import * as vscode from 'vscode';

export abstract class ItemModel implements vscode.Disposable {
  #disposableChildren: vscode.Disposable[] = [];

  abstract getTreeItem(): vscode.TreeItem;

  abstract getChildren(): Promise<vscode.TreeItem[] | ItemModel[]>;

  protected setDisposableChildren(children: vscode.Disposable[]): void {
    this.#disposableChildren
      .filter(child => !children.includes(child))
      .forEach(child => child.dispose());
    this.#disposableChildren = children;
  }

  dispose(): void {
    this.#disposableChildren.forEach(ch => ch.dispose());
  }
}
