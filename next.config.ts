import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Disable the dev-mode indicator badge: its <nextjs-portal> overlay
  // was intercepting taps in the bottom-left corner (mobile drawer's
  // Profile / Settings / Logout row) and breaking real interactions.
  devIndicators: false,
};

export default nextConfig;
