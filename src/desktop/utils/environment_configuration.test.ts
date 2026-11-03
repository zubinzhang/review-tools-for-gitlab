import {
  getEnvCredentials,
  getEnvInstanceUrl,
  normalizeGitLabHost,
} from './environment_configuration';

type EnvVar =
  'GITLAB_WORKFLOW_INSTANCE_URL' | 'GITLAB_WORKFLOW_TOKEN' | 'GITLAB_HOST' | 'GITLAB_TOKEN';

describe('environment_configuration', () => {
  const setEnv = (vars: Partial<Record<EnvVar, string>>) => {
    Object.assign(process.env, vars);
  };

  afterEach(() => {
    delete process.env.GITLAB_WORKFLOW_INSTANCE_URL;
    delete process.env.GITLAB_WORKFLOW_TOKEN;
    delete process.env.GITLAB_HOST;
    delete process.env.GITLAB_TOKEN;
  });

  describe('normalizeGitLabHost', () => {
    it.each`
      input                                    | expected
      ${'gitlab.example.com'}                  | ${'https://gitlab.example.com'}
      ${'GitLab.Example.com'}                  | ${'https://gitlab.example.com'}
      ${'gitlab.example.com/'}                 | ${'https://gitlab.example.com'}
      ${'gitlab.example.com:8443'}             | ${'https://gitlab.example.com:8443'}
      ${'https://gitlab.example.com/'}         | ${'https://gitlab.example.com'}
      ${'http://gitlab.example.com'}           | ${'http://gitlab.example.com'}
      ${'https://gitlab.example.com/sub/path'} | ${'https://gitlab.example.com/sub/path'}
    `('normalizes $input to $expected', ({ input, expected }) => {
      expect(normalizeGitLabHost(input)).toBe(expected);
    });
  });

  describe('getEnvInstanceUrl', () => {
    it('returns undefined when nothing is set', () => {
      expect(getEnvInstanceUrl()).toBeUndefined();
    });

    it('prefers GITLAB_WORKFLOW_INSTANCE_URL over GITLAB_HOST', () => {
      setEnv({
        GITLAB_WORKFLOW_INSTANCE_URL: 'https://workflow.example.com/',
        GITLAB_HOST: 'host.example.com',
      });

      expect(getEnvInstanceUrl()).toBe('https://workflow.example.com');
    });

    it('trims whitespace and treats blank values as unset', () => {
      setEnv({ GITLAB_WORKFLOW_INSTANCE_URL: '   ', GITLAB_HOST: ' host.example.com\n' });

      expect(getEnvInstanceUrl()).toBe('https://host.example.com');
    });
  });

  describe('getEnvCredentials', () => {
    it('returns undefined when only a token is set', () => {
      setEnv({ GITLAB_TOKEN: 'glpat-abc' });

      expect(getEnvCredentials()).toBeUndefined();
    });

    it('returns undefined when only a host is set', () => {
      setEnv({ GITLAB_HOST: 'host.example.com' });

      expect(getEnvCredentials()).toBeUndefined();
    });

    it('uses GITLAB_WORKFLOW_* variables', () => {
      setEnv({
        GITLAB_WORKFLOW_INSTANCE_URL: 'https://workflow.example.com',
        GITLAB_WORKFLOW_TOKEN: 'wf',
      });

      expect(getEnvCredentials()).toEqual({
        instanceUrl: 'https://workflow.example.com',
        token: 'wf',
        usesGitLabCliVariables: false,
      });
    });

    it('uses GITLAB_HOST and GITLAB_TOKEN', () => {
      setEnv({ GITLAB_HOST: 'host.example.com', GITLAB_TOKEN: ' glpat-abc\n' });

      expect(getEnvCredentials()).toEqual({
        instanceUrl: 'https://host.example.com',
        token: 'glpat-abc',
        usesGitLabCliVariables: true,
      });
    });

    it('prefers the GITLAB_WORKFLOW_* pair over the GITLAB_* pair', () => {
      setEnv({
        GITLAB_WORKFLOW_INSTANCE_URL: 'https://workflow.example.com',
        GITLAB_WORKFLOW_TOKEN: 'wf',
        GITLAB_HOST: 'host.example.com',
        GITLAB_TOKEN: 'glpat-abc',
      });

      expect(getEnvCredentials()).toEqual({
        instanceUrl: 'https://workflow.example.com',
        token: 'wf',
        usesGitLabCliVariables: false,
      });
    });

    it('does not pair GITLAB_WORKFLOW_INSTANCE_URL with GITLAB_TOKEN', () => {
      setEnv({
        GITLAB_WORKFLOW_INSTANCE_URL: 'https://workflow.example.com',
        GITLAB_TOKEN: 'glpat-abc',
      });

      expect(getEnvCredentials()).toBeUndefined();
    });

    it('does not pair GITLAB_HOST with GITLAB_WORKFLOW_TOKEN', () => {
      setEnv({ GITLAB_HOST: 'host.example.com', GITLAB_WORKFLOW_TOKEN: 'wf' });

      expect(getEnvCredentials()).toBeUndefined();
    });

    it('falls back to the complete GITLAB_* pair when the GITLAB_WORKFLOW_* pair is incomplete', () => {
      setEnv({
        GITLAB_WORKFLOW_INSTANCE_URL: 'https://workflow.example.com',
        GITLAB_HOST: 'host.example.com',
        GITLAB_TOKEN: 'glpat-abc',
      });

      expect(getEnvCredentials()).toEqual({
        instanceUrl: 'https://host.example.com',
        token: 'glpat-abc',
        usesGitLabCliVariables: true,
      });
    });
  });
});
