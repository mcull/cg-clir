/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.module.rules.push({
      test: /\.html$/,
      type: "asset/source",
    });
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.artcld.com",
      },
      {
        protocol: "https",
        hostname: "*.r2.cloudflarestorage.com",
      },
      {
        protocol: "https",
        hostname: "*.r2.dev",
      },
      {
        protocol: "https",
        hostname: "pub-478aaab5f70c43228f5221bf2ba7974a.r2.dev",
      },
    ],
  },
};

export default nextConfig;
