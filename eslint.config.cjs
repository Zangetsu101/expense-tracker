const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['.expo/**', '.private/**', '.scratch/**', '.agents/**', 'dist/**', 'web-build/**'],
  },
]);
