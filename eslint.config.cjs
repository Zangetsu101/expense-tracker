const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    rules: {
      'no-nested-ternary': 'error',
    },
  },
  {
    ignores: ['.expo/**', '.private/**', '.scratch/**', '.agents/**', 'dist/**', 'web-build/**'],
  },
]);
