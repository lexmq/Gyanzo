import type { NextConfig } from "next";

/* API routes that talk to z-ai-web-dev-sdk. The SDK reads its
   .z-ai-config file from process.cwd() at runtime — on Vercel the file is
   materialized by scripts/write-zai-config.mjs during the build and then
   bundled into each of these serverless functions. */
const ZAI_ROUTES = [
  "/api/chat",
  "/api/summaries",
  "/api/explanations",
  "/api/flashcards",
  "/api/quiz",
  "/api/revision-notes",
  "/api/mind-maps",
  "/api/citations",
  "/api/vocabulary",
  "/api/exam-prediction",
  "/api/formula-sheet",
  "/api/voice-tutor",
  "/api/pdfs/[id]/summary",
];

const outputFileTracingIncludes = Object.fromEntries(
  ZAI_ROUTES.map((route) => [route, ["./.z-ai-config"]])
);

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes,
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
