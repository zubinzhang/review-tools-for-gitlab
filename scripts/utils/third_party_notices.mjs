import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function findPackage(directory) {
  if (directory === path.dirname(directory)) return undefined;
  const source = await fs
    .readFile(path.join(directory, 'package.json'), 'utf8')
    .catch(() => undefined);
  const manifest = source ? JSON.parse(source) : undefined;
  return manifest?.name && manifest?.version
    ? [directory, manifest]
    : findPackage(path.dirname(directory));
}

export async function createThirdPartyNotices(filenames) {
  const discovered = await Promise.all(
    filenames
      .filter(filename => filename.includes(`${path.sep}node_modules${path.sep}`))
      .map(filename => findPackage(path.dirname(filename))),
  );
  const packages = new Map(discovered.filter(Boolean));
  const sections = await Promise.all(
    [...packages].map(async ([directory, manifest]) => {
      const files = (await fs.readdir(directory))
        .filter(name => /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i.test(name))
        .sort();
      const texts = await Promise.all(
        files.map(
          async name => `${name}\n${await fs.readFile(path.join(directory, name), 'utf8')}`,
        ),
      );
      if (!files.some(name => /^(?:licen[cs]e|copying)/i.test(name))) {
        const fallback = path.join(
          fileURLToPath(new URL('../../third_party/licenses/', import.meta.url)),
          `${manifest.name.replaceAll('/', '-')}-${manifest.version}.txt`,
        );
        const license = await fs.readFile(fallback, 'utf8').catch(() => undefined);
        if (!license)
          throw new Error(
            `Missing license text for bundled package ${manifest.name}@${manifest.version}`,
          );
        texts.push(license);
      }
      return `${manifest.name}@${manifest.version}\nLicense: ${manifest.license ?? 'See license text below'}\n\n${texts.join('\n\n')}`;
    }),
  );
  return `Third-party notices for bundled extension and webview dependencies\n\n${sections.sort().join('\n\n----------------------------------------\n\n')}\n`;
}

export async function writeThirdPartyNotices(root) {
  const dist = path.join(root, 'dist-desktop');
  const extension = JSON.parse(await fs.readFile(path.join(dist, 'extension.meta.json'), 'utf8'));
  const webview = JSON.parse(
    await fs.readFile(path.join(dist, 'webviews/issuable/dependency-modules.json'), 'utf8'),
  );
  const filenames = [
    ...Object.keys(extension.inputs).map(filename => path.resolve(root, filename)),
    ...webview,
  ];
  await fs.writeFile(
    path.join(dist, 'THIRD_PARTY_NOTICES.txt'),
    await createThirdPartyNotices(filenames),
  );
}
