const { withDangerousMod } = require('expo/config-plugins');
const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

const archive = 'gradle-9.4.1-bin.zip';
// Gradle's official checksum, also matched against Huawei Cloud's mirror.
const checksum = '2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb';

module.exports = (config) =>
  withDangerousMod(config, [
    'android',
    async (mod) => {
      const path = join(
        mod.modRequest.platformProjectRoot,
        'gradle/wrapper/gradle-wrapper.properties',
      );
      const properties = await readFile(path, 'utf8');
      const distribution = properties.match(/^distributionUrl=.*\/(.+)$/m)?.[1];
      if (distribution !== archive)
        throw new Error('Gradle version changed. Review the mirror URL and official checksum.');
      let next = properties.replace(
        /^distributionUrl=.*$/m,
        `distributionUrl=https\\://mirrors.huaweicloud.com/gradle/${archive}`,
      );
      next = /^distributionSha256Sum=.*$/m.test(next)
        ? next.replace(/^distributionSha256Sum=.*$/m, `distributionSha256Sum=${checksum}`)
        : `${next.trimEnd()}\ndistributionSha256Sum=${checksum}\n`;
      await writeFile(path, next);
      return mod;
    },
  ]);
