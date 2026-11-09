module.exports = ({ config }) => {
  if (process.env.EXPENSE_TRACKER_BUILD_TARGET !== 'emulator') return config;

  return {
    ...config,
    name: `${config.name} (Emulator)`,
    scheme: `${config.scheme}-emulator`,
    android: {
      ...config.android,
      package: `${config.android.package}.emulator`,
    },
    updates: {
      ...config.updates,
      enabled: false,
    },
  };
};
