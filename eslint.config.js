const gitlab = require('@gitlab/eslint-plugin/eslint9');
const importXPlugin = require('eslint-plugin-import-x');
const prettier = require('eslint-config-prettier');

const { settings: importTsSettings, rules: importTsRules } = importXPlugin.flatConfigs.typescript;

module.exports = [
  { ignores: ['**/.*/', 'node_modules/', 'webviews/', 'out/', 'dist-*/', 'eslint.config.js'] },
  ...gitlab.configs.typescript,
  {
    settings: { 'import-x/resolver': { node: { extensions: ['.js', '.mjs', '.ts'] } } },
    rules: {
      'import-x/extensions': [
        'error',
        'ignorePackages',
        { js: 'never', mjs: 'never', ts: 'never', tsx: 'never' },
      ],
      'promise/param-names': 'off',
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: [
            'scripts/**/*',
            '**/*.test.js',
            '**/*.test.ts',
            'test/**/*',
            'jest_*.js',
          ],
        },
      ],
      // ignoring graphql-request due to a bug in eslint-plugin-import https://github.com/import-js/eslint-plugin-import/issues/2703
      'import-x/no-unresolved': [2, { ignore: ['vscode', 'graphql-request', '^uuid$'] }],
      'import-x/no-deprecated': 'warn',
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: 'src/common/**',
              from: ['src/desktop/**', 'src/browser/**'],
              message: "Code in src/common can't import desktop-specific or browser-specific code.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts'],
    settings: importTsSettings,
    rules: importTsRules,
  },
  { files: ['**/*.mjs'], rules: { 'import-x/extensions': ['error', 'ignorePackages'] } },
  {
    files: ['test/e2e/**'],
    rules: {
      'import-x/no-extraneous-dependencies': [
        'error',
        { packageDir: ['.', 'test/e2e'], devDependencies: true },
      ],
      'import-x/extensions': ['error', 'ignorePackages', { ts: 'never' }],
      'import-x/no-unresolved': [
        2,
        {
          ignore: [
            '@wdio/globals',
            'allure-commandline',
            '@wdio/json-reporter/mergeResults',
            '@influxdata/influxdb-client',
            '@wdio/logger',
            '^uuid$',
            'winston',
            '@ffmpeg-installer/ffmpeg',
          ],
        },
      ],
      'import-x/prefer-default-export': 'off',
    },
  },
  { files: ['test/e2e/helpers/*.js'], languageOptions: { globals: { $: 'readonly' } } },
  prettier,

  // Rules turned off by eslint-config-prettier that are needed for .ts files only, matching the
  // old typescript.js override block scoped to **/*.ts.
  {
    files: ['**/*.ts'],
    rules: {
      semi: [2, 'always'],
      'no-extra-semi': 'error',
      'no-mixed-spaces-and-tabs': 'error',
      'no-unexpected-multiline': 'error',
    },
  },

  // Rules from @typescript-eslint/strict v7 that the shared eslint9 config does not enable.
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/ban-ts-comment': ['error', { minimumDescriptionLength: 10 }],
      // @typescript-eslint/ban-types was split in typescript-eslint v8.
      '@typescript-eslint/no-empty-object-type': 'error',
      '@typescript-eslint/no-unsafe-function-type': 'error',
      '@typescript-eslint/no-wrapper-object-types': 'error',
      // Extension rules: disable the core rule to avoid double-reporting.
      'no-array-constructor': 'off',
      '@typescript-eslint/no-array-constructor': 'error',
      'no-useless-constructor': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      '@typescript-eslint/no-useless-constructor': 'error',
      '@typescript-eslint/no-duplicate-enum-values': 'error',
      '@typescript-eslint/no-dynamic-delete': 'error',
      '@typescript-eslint/no-extra-non-null-assertion': 'error',
      '@typescript-eslint/no-extraneous-class': 'error',
      '@typescript-eslint/no-invalid-void-type': 'error',
      '@typescript-eslint/no-misused-new': 'error',
      '@typescript-eslint/no-namespace': 'error',
      '@typescript-eslint/no-non-null-asserted-nullish-coalescing': 'error',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
      '@typescript-eslint/no-this-alias': 'error',
      '@typescript-eslint/no-unnecessary-type-constraint': 'error',
      '@typescript-eslint/no-unsafe-declaration-merging': 'error',
      '@typescript-eslint/prefer-as-const': 'error',
      '@typescript-eslint/prefer-literal-enum-member': 'error',
      '@typescript-eslint/triple-slash-reference': 'error',
      '@typescript-eslint/unified-signatures': 'error',
    },
  },
];
