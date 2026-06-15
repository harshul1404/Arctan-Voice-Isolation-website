/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/eigen',
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb"
    }
  }
};

export default nextConfig;
