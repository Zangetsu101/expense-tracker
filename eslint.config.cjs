const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native-reanimated',
              importNames: ['useTimestamp'],
              message:
                'Use useAnimationClock from @/components/animation-clock to share the global frame clock.',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['.expo/**', '.private/**', '.scratch/**', '.agents/**', 'dist/**', 'web-build/**'],
  },
]);
