const { getDefaultConfig } = require('expo/metro-config');
const { dirname } = require('node:path');

const config = getDefaultConfig(dirname(require.resolve('./package.json')));

config.resolver.assetExts.push('wasm');
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  middleware(req, res, next);
};

module.exports = config;
