const esbuild = require('esbuild');

// why: A handful of node_modules packages ship ESM-only builds (@anycable/core, p-queue,
//      p-timeout, nanoevents, uuid). ts-jest can't process them, so we transpile them to
//      CommonJS with esbuild before jest requires them.
module.exports = {
  process(sourceText, filename) {
    const { code, map } = esbuild.transformSync(sourceText, {
      loader: 'js',
      format: 'cjs',
      target: 'node18.17',
      sourcefile: filename,
      sourcemap: true,
    });
    return { code, map };
  },
};
