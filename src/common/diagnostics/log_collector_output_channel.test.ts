import * as vscode from 'vscode';
import { LogCollectorOutputChannel } from './log_collector_output_channel';
import { languageServerLogCollector } from './log_collector';

const mockOutputChannel = {
  logLevel: 3,
  onDidChangeLogLevel: jest.fn(),
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  append: jest.fn(),
  appendLine: jest.fn(),
  replace: jest.fn(),
  clear: jest.fn(),
  show: jest.fn(),
  hide: jest.fn(),
  dispose: jest.fn(),
  name: 'Test Channel',
};

jest.mock('vscode', () => ({
  LogLevel: { Off: 0, Trace: 1, Debug: 2, Info: 3, Warning: 4, Error: 5 },
  window: {
    createOutputChannel: jest.fn(() => mockOutputChannel),
  },
}));

jest.mock('./log_collector', () => ({
  languageServerLogCollector: {
    append: jest.fn(),
    clear: jest.fn(),
    getAll: jest.fn(),
  },
}));

describe('LogCollectorOutputChannel', () => {
  let channel: LogCollectorOutputChannel;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOutputChannel.logLevel = vscode.LogLevel.Info;
    channel = new LogCollectorOutputChannel('Test Channel');
  });

  it('creates a log output channel', () => {
    expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('Test Channel', { log: true });
  });

  describe('logLevel', () => {
    it('returns the delegate channel log level', () => {
      expect(channel.logLevel).toBe(vscode.LogLevel.Info);
    });
  });

  describe.each`
    method     | label
    ${'trace'} | ${'trace'}
    ${'debug'} | ${'debug'}
    ${'info'}  | ${'info'}
    ${'warn'}  | ${'warning'}
    ${'error'} | ${'error'}
  `(
    '$method',
    ({
      method,
      label,
    }: {
      method: 'trace' | 'debug' | 'info' | 'warn' | 'error';
      label: string;
    }) => {
      beforeEach(() => {
        mockOutputChannel.logLevel = vscode.LogLevel.Trace;
      });

      it('delegates to the output channel', () => {
        channel[method]('message', 'arg');
        expect(mockOutputChannel[method]).toHaveBeenCalledWith('message', 'arg');
      });

      it('collects the message with its level', () => {
        channel[method]('message', 'arg');
        expect(languageServerLogCollector.append).toHaveBeenCalledWith(`[${label}] message arg`);
      });
    },
  );

  describe('log level filtering', () => {
    it('does not collect messages below the channel log level', () => {
      channel.debug('hidden');
      expect(languageServerLogCollector.append).not.toHaveBeenCalled();
    });

    it('does not collect messages when logging is off', () => {
      mockOutputChannel.logLevel = vscode.LogLevel.Off;
      channel.error('hidden');
      expect(languageServerLogCollector.append).not.toHaveBeenCalled();
    });
  });

  it('collects the stack of an error', () => {
    const error = new Error('boom');
    channel.error(error);
    expect(languageServerLogCollector.append).toHaveBeenCalledWith(`[error] ${error.stack}`);
  });

  describe('name', () => {
    it('returns the delegate channel name', () => {
      expect(channel.name).toBe('Test Channel');
    });
  });

  describe('append', () => {
    it('delegates to the output channel', () => {
      channel.append('hello');
      expect(mockOutputChannel.append).toHaveBeenCalledWith('hello');
    });

    it('collects the value in the log collector', () => {
      channel.append('hello');
      expect(languageServerLogCollector.append).toHaveBeenCalledWith('hello');
    });
  });

  describe('appendLine', () => {
    it('delegates to the output channel', () => {
      channel.appendLine('line');
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith('line');
    });

    it('collects the value in the log collector', () => {
      channel.appendLine('line');
      expect(languageServerLogCollector.append).toHaveBeenCalledWith('line');
    });
  });

  describe('replace', () => {
    it('delegates to the output channel', () => {
      channel.replace('new content');
      expect(mockOutputChannel.replace).toHaveBeenCalledWith('new content');
    });

    it('clears the collector then appends new content', () => {
      channel.replace('new content');
      expect(languageServerLogCollector.clear).toHaveBeenCalled();
      expect(languageServerLogCollector.append).toHaveBeenCalledWith('new content');
    });
  });

  describe('clear', () => {
    it('delegates to the output channel', () => {
      channel.clear();
      expect(mockOutputChannel.clear).toHaveBeenCalled();
    });

    it('does not clear the collector (preserves history for export)', () => {
      channel.clear();
      expect(languageServerLogCollector.clear).not.toHaveBeenCalled();
    });
  });

  describe('show', () => {
    it('delegates with preserveFocus boolean', () => {
      channel.show(true);
      expect(mockOutputChannel.show).toHaveBeenCalledWith(true);
    });

    it('delegates with column and preserveFocus', () => {
      channel.show(1, false);
      expect(mockOutputChannel.show).toHaveBeenCalledWith(1, false);
    });
  });

  describe('hide', () => {
    it('delegates to the output channel', () => {
      channel.hide();
      expect(mockOutputChannel.hide).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('delegates to the output channel', () => {
      channel.dispose();
      expect(mockOutputChannel.dispose).toHaveBeenCalled();
    });
  });
});
