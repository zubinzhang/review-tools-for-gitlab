import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createThirdPartyNotices } from './third_party_notices.mjs';

test('includes copyright and notice texts once per bundled package without local paths', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'review-notices-'));
  try {
    const dependency = path.join(directory, 'node_modules', '@example', 'library');
    await fs.mkdir(path.join(dependency, 'lib'), { recursive: true });
    await fs.writeFile(
      path.join(dependency, 'package.json'),
      JSON.stringify({ name: '@example/library', version: '1.2.3', license: 'Apache-2.0' }),
    );
    await fs.writeFile(path.join(dependency, 'LICENSE.txt'), 'Copyright Example\nLicense text');
    await fs.writeFile(path.join(dependency, 'NOTICE'), 'Required attribution');
    const notices = await createThirdPartyNotices([
      path.join(dependency, 'lib', 'index.js'),
      path.join(dependency, 'lib', 'other.js'),
    ]);
    assert.equal(notices.match(/@example\/library@1.2.3/g).length, 1);
    assert.ok(notices.includes('Copyright Example'));
    assert.ok(notices.includes('Required attribution'));
    assert.ok(!notices.includes(directory));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('fails packaging when a bundled dependency has no license text', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'review-notices-'));
  try {
    const dependency = path.join(directory, 'node_modules', 'missing-license');
    await fs.mkdir(dependency, { recursive: true });
    await fs.writeFile(
      path.join(dependency, 'package.json'),
      JSON.stringify({ name: 'missing-license', version: '1.0.0' }),
    );
    await assert.rejects(
      createThirdPartyNotices([path.join(dependency, 'index.js')]),
      /license text.*missing-license/i,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
