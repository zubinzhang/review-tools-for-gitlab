import { isKeepAliveAffectedNodeVersion } from './is_keep_alive_affected_node_version';

describe('isKeepAliveAffectedNodeVersion', () => {
  const originalVersions = process.versions;

  afterEach(() => {
    Object.defineProperty(process, 'versions', {
      value: originalVersions,
      writable: true,
      configurable: true,
    });
  });

  const setNodeVersion = (version: string) => {
    Object.defineProperty(process, 'versions', {
      value: { ...originalVersions, node: version },
      writable: true,
      configurable: true,
    });
  };

  const cases: [version: string, affected: boolean, description: string][] = [
    ['24.17.0', true, 'the affected version'],
    ['24.17.1', true, 'a patch of the affected minor'],
    ['24.18.0', false, 'the fixed version'],
    ['24.16.0', false, 'before the regression'],
    ['22.17.0', false, 'unrelated major'],
    ['20.17.0', false, 'unrelated major'],
    ['25.0.0', false, 'future major'],
  ];

  cases.forEach(([version, affected, description]) => {
    it(`returns ${affected} for Node ${version} (${description})`, () => {
      setNodeVersion(version);
      expect(isKeepAliveAffectedNodeVersion()).toBe(affected);
    });
  });
});
