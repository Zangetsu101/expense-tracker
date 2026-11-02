const { withAppBuildGradle } = require('expo/config-plugins');

const signingScript = 'apply from: rootProject.file("../scripts/android-release.gradle")';

function configureReleaseSigning(contents) {
  if (contents.includes(signingScript)) return contents;
  const releaseSigning = /(release\s*\{\s*(?:\/\/[^\n]*\n\s*)*)signingConfig signingConfigs\.debug/;
  if (!releaseSigning.test(contents)) {
    throw new Error('Android release signing template changed. Review the generated app/build.gradle before building.');
  }
  return `${contents.replace(releaseSigning, '$1// Signing is configured by android-release.gradle.')}\n${signingScript}\n`;
}

module.exports = (config) => withAppBuildGradle(config, (mod) => {
  if (mod.modResults.language !== 'groovy') throw new Error('Release signing requires a Groovy app/build.gradle.');
  mod.modResults.contents = configureReleaseSigning(mod.modResults.contents);
  return mod;
});
