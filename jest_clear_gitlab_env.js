// Keep a developer's shell (e.g. a glab GITLAB_TOKEN) out of unit tests.
// Mirrors the list in test/e2e/wdio.conf.js, which is a separate ES-module package.
[
  'GITLAB_WORKFLOW_INSTANCE_URL',
  'GITLAB_WORKFLOW_TOKEN',
  'GITLAB_WORKFLOW_TOKEN_FILE',
  'GITLAB_HOST',
  'GITLAB_TOKEN',
].forEach(name => Reflect.deleteProperty(process.env, name));
