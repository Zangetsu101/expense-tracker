import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const withGradleMirror = require('../plugins/with-gradle-mirror.cjs');
const template = `distributionUrl=https\\://services.gradle.org/distributions/gradle-9.4.1-bin.zip
networkTimeout=10000
validateDistributionUrl=true
`;
async function fixture(contents, run) {
  const directory = await mkdtemp(join(tmpdir(), 'expense-gradle-mirror-'));
  const path = join(directory, 'gradle/wrapper/gradle-wrapper.properties');
  try {
    await mkdir(join(directory, 'gradle/wrapper'), { recursive: true });
    await writeFile(path, contents);
    const config = withGradleMirror({ name: 'test', slug: 'test' });
    const apply = () =>
      config.mods.android.dangerous({
        ...config,
        modResults: {},
        modRequest: { platformProjectRoot: directory },
      });
    await run(apply, () => readFile(path, 'utf8'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('prebuild pins the Huawei Gradle mirror and official checksum without changing wrapper behavior', async () => {
  for (const contents of [template, `${template}distributionSha256Sum=old\n`]) {
    await fixture(contents, async (apply, read) => {
      await apply();
      const result = await read();
      assert.equal(
        result,
        `distributionUrl=https\\://mirrors.huaweicloud.com/gradle/gradle-9.4.1-bin.zip
networkTimeout=10000
validateDistributionUrl=true
distributionSha256Sum=2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb
`,
      );
      await apply();
      assert.equal(await read(), result);
    });
  }
});

test('prebuild refuses a Gradle version change until its mirror and checksum are reviewed', async () => {
  const changed = template.replace('9.4.1', '9.4.0');
  await fixture(changed, async (apply, read) => {
    await assert.rejects(apply(), /Gradle version changed/);
    assert.equal(await read(), changed);
  });
});
