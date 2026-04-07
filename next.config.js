/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Exclude onnxruntime-node completely from client-side bundle
    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'onnxruntime-node': false,
        'fs': false,
        'path': false,
        'crypto': false,
      };
    }

    // Ignore .node files and node-specific files
    config.module = config.module || {};
    config.module.rules = config.module.rules || [];
    config.module.rules.push({
      test: /\.node$/,
      loader: 'node-loader',
    });

    // Completely ignore node-specific ONNX files
    config.plugins = config.plugins || [];
    config.plugins.push(
      new (require('webpack').IgnorePlugin)({
        resourceRegExp: /ort\.node\.min\.mjs$/,
      })
    );

    return config;
  },
};

module.exports = nextConfig;