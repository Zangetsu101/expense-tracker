module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  clearMocks: true,
};
