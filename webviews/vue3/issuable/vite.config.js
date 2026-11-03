import { defineConfig } from 'vite';
import buildConfigForWebview from '../vite.config.shared';

const config = buildConfigForWebview('issuable');
config.plugins.push({
  name: 'review-dependency-inventory',
  generateBundle(options, bundle) {
    const modules = Object.values(bundle)
      .filter(output => output.type === 'chunk')
      .flatMap(output => Object.keys(output.modules))
      .filter(filename => filename.includes('/node_modules/'))
      .map(filename => filename.replace(/^\0/, '').replace(/\?.*$/, ''));
    this.emitFile({
      type: 'asset',
      fileName: 'issuable/dependency-modules.json',
      source: JSON.stringify([...new Set(modules)]),
    });
  },
});
export default defineConfig(config);
