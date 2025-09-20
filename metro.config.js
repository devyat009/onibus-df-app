// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Customize the config
config.resolver.alias = {
  '@': './src',
  '@components': './src/components',
  '@services': './src/services',
  '@utils': './src/utils',
  '@types': './src/types',
  '@assets': './src/assets'
};

// Add HTML to asset extensions
config.resolver.assetExts.push('html');

// Add SVG to source extensions
config.transformer.babelTransformerPath = require.resolve('react-native-svg-transformer');
config.resolver.assetExts = config.resolver.assetExts.filter(ext => ext !== 'svg');
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg'];

module.exports = config;
