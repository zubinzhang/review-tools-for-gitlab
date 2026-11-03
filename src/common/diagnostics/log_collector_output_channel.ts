import * as vscode from 'vscode';
import { languageServerLogCollector } from './log_collector';

const levelLabel = (level: vscode.LogLevel): string => {
  switch (level) {
    case vscode.LogLevel.Trace:
      return 'trace';
    case vscode.LogLevel.Debug:
      return 'debug';
    case vscode.LogLevel.Warning:
      return 'warning';
    case vscode.LogLevel.Error:
      return 'error';
    default:
      return 'info';
  }
};

const formatArg = (arg: unknown): string => {
  if (arg instanceof Error) return arg.stack ?? arg.message;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
};

/**
 * LogCollectorOutputChannel wraps a VS Code LogOutputChannel and intercepts
 * all log output to also collect it in the languageServerLogCollector.
 * This allows us to capture language server logs for diagnostics export.
 */
export class LogCollectorOutputChannel implements vscode.LogOutputChannel {
  #delegate: vscode.LogOutputChannel;

  constructor(name: string) {
    this.#delegate = vscode.window.createOutputChannel(name, { log: true });
  }

  get name(): string {
    return this.#delegate.name;
  }

  get logLevel(): vscode.LogLevel {
    return this.#delegate.logLevel;
  }

  get onDidChangeLogLevel(): vscode.Event<vscode.LogLevel> {
    return this.#delegate.onDidChangeLogLevel;
  }

  trace(message: string, ...args: unknown[]): void {
    this.#delegate.trace(message, ...args);
    this.#collect(vscode.LogLevel.Trace, message, args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.#delegate.debug(message, ...args);
    this.#collect(vscode.LogLevel.Debug, message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.#delegate.info(message, ...args);
    this.#collect(vscode.LogLevel.Info, message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.#delegate.warn(message, ...args);
    this.#collect(vscode.LogLevel.Warning, message, args);
  }

  error(error: string | Error, ...args: unknown[]): void {
    this.#delegate.error(error, ...args);
    this.#collect(vscode.LogLevel.Error, error, args);
  }

  append(value: string): void {
    this.#delegate.append(value);
    // Collect for diagnostics export
    languageServerLogCollector.append(value);
  }

  appendLine(value: string): void {
    this.#delegate.appendLine(value);
    // Collect for diagnostics export
    languageServerLogCollector.append(value);
  }

  replace(value: string): void {
    this.#delegate.replace(value);
    // Note: replace clears then appends, we'll just treat it as new content
    languageServerLogCollector.clear();
    languageServerLogCollector.append(value);
  }

  clear(): void {
    this.#delegate.clear();
    // Don't clear the collector - we want to keep history for export
    // Users can manually clear if needed
  }

  show(preserveFocus?: boolean): void;

  show(column?: vscode.ViewColumn, preserveFocus?: boolean): void;

  show(columnOrPreserveFocus?: vscode.ViewColumn | boolean, preserveFocus?: boolean): void {
    if (typeof columnOrPreserveFocus === 'boolean') {
      this.#delegate.show(columnOrPreserveFocus);
    } else {
      this.#delegate.show(columnOrPreserveFocus, preserveFocus);
    }
  }

  hide(): void {
    this.#delegate.hide();
  }

  dispose(): void {
    this.#delegate.dispose();
  }

  // why: mirror what the output channel shows, so trace/debug noise doesn't
  //      fill the collector's ring buffer when the user hasn't enabled it
  #collect(level: vscode.LogLevel, message: string | Error, args: unknown[]): void {
    const currentLevel = this.#delegate.logLevel;
    if (currentLevel === vscode.LogLevel.Off || level < currentLevel) return;

    const text = [message, ...args].map(formatArg).join(' ');
    languageServerLogCollector.append(`[${levelLabel(level)}] ${text}`);
  }
}
