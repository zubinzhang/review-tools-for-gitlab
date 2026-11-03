/**
 * Returns true if the current Node.js version is affected by the keep-alive
 * regression introduced in Node 24.17.0 and fixed in Node 24.18.0.
 *
 * VS Code 1.128.0 ships Electron 42.5.0 with Node 24.17.0, which introduced a
 * regression in `http.Agent` keep-alive socket handling that breaks `node-fetch`
 * v2 gzip/chunked responses, causing authentication failures.
 *
 * See https://github.com/nodejs/node/issues/63989
 * See https://github.com/node-fetch/node-fetch/issues/1767
 */
export const isKeepAliveAffectedNodeVersion = (): boolean => {
  const nodeVersion = process.versions.node;
  // The regression was introduced in 24.17.0 and fixed in 24.18.0.
  // Only disable keep-alive for the affected minor version (24.17.x).
  const [major, minor] = nodeVersion.split('.').map(Number);
  return major === 24 && minor === 17;
};
