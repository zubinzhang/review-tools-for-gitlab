// why: v11 converters schedule work through vscode-jsonrpc, which needs its runtime
//      abstraction layer. Production installs it when the client loads; tests must import it.
import 'vscode-languageclient/node';
import type { Code2ProtocolConverter, Protocol2CodeConverter } from 'vscode-languageclient';
import { createConverter as createCode2ProtocolConverter } from 'vscode-languageclient/$test/common/codeConverter';
import { createConverter as createProtocol2CodeConverter } from 'vscode-languageclient/$test/common/protocolConverter';

// why: production code takes the converters from the language client, but tests don't
//      have a client. These match the defaults the client uses for our client options.
export const createTestProtocol2CodeConverter = (): Protocol2CodeConverter =>
  createProtocol2CodeConverter(undefined, false, false, false);

export const createTestCode2ProtocolConverter = (): Code2ProtocolConverter =>
  createCode2ProtocolConverter(undefined);
