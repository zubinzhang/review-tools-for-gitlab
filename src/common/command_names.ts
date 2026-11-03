export const VS_COMMANDS = {
  DIFF: 'vscode.diff',
  OPEN: 'vscode.open',
  GIT_SHOW_OUTPUT: 'git.showOutput',
  GIT_CLONE: 'git.clone',
  MARKDOWN_SHOW_PREVIEW: 'markdown.showPreview',
  OPEN_SETTINGS: 'workbench.action.openSettings',
  RELOAD_WINDOW: 'workbench.action.reloadWindow',
};

export const USER_COMMANDS = {
  AUTHENTICATE: 'gitlab-review.authenticate',
  SHOW_LOGS: 'gitlab-review.showOutput',
  SHOW_DIAGNOSTICS: 'gl.showDiagnostics',
  EXPORT_DIAGNOSTICS: 'gl.exportDiagnostics',
  // Duo Chat WebView commands
  CLOSE_CHAT: 'gl.webview.closeChat',
  EXPLAIN_SELECTED_CODE: 'gl.webview.explainSelectedCode',
  EXPLAIN_SELECTED_TERMINAL_OUTPUT: 'gl.webview.explainSelectedTerminalOutput',
  GENERATE_TESTS: 'gl.webview.generateTests',
  REFACTOR_CODE: 'gl.webview.refactorCode',
  FIX_CODE: 'gl.webview.fixCode',
  NEW_CHAT_CONVERSATION: 'gl.webview.newChatConversation',
  FOCUS_CHAT: 'gl.webview.focusChat',
  DUO_TUTORIAL: 'gl.duoTutorial',
  SHOW_DIAGNOSTICS_FROM_SIDE_PANEL: 'gl.showDiagnosticsFromSidePanel',
  AGENTIC_CHAT_NEW_CONVERSATION: 'gl.agenticChat.startNewConversation',
  AGENTIC_CHAT_HISTORY: 'gl.agenticChat.showHistoryView',
  MCP_OPEN_USER_CONFIG: 'gl.mcp.openUserConfig',
};

// Contributed in desktop.package.json and registered dynamically in setupWebviews
// from MCP_DASHBOARD_WEBVIEW_ID. Declared here so the common webview handler can
// reference it without importing desktop-specific code; mirrored in desktop USER_COMMANDS.
export const WEBVIEW_ROOT_MCP_SHOW = 'gl.webview.root.mcp.show';
