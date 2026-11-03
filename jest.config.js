// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

module.exports = {
  preset: 'ts-jest',
  clearMocks: true,
  coverageProvider: 'v8',
  coverageReporters: ['cobertura'],
  coverageDirectory: './reports',
  roots: ['src'],
  setupFiles: ['<rootDir>/jest_clear_gitlab_env.js'],
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: 'reports',
        outputName: 'unit.xml',
        titleTemplate: '{title}',
        classNameTemplate: '{classname}',
      },
    ],
  ],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/webviews/', '/dist-/'],
  transformIgnorePatterns: [
    '/node_modules/(?!(@anycable/core|p-queue|p-timeout|nanoevents|uuid)/)',
  ],
  transform: {
    // why: For some reason, ts-jest was not working for these node_modules
    //      using esbuild to transform them to CommonJS, we're good to go.
    '/node_modules/(@anycable/core|p-queue|p-timeout|nanoevents|uuid).+\\.js$':
      '<rootDir>/jest_esm_transformer.js',
    '^.+\\.html?$': '<rootDir>/jest_html_transformer.js',
  },
  testEnvironment: 'node',
};
