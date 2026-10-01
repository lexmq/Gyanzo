import type { NextConfig } from "next";
import { existsSync } from "node:fs";

/* API routes that talk to z-ai-web-dev-sdk. The SDK reads its
   .z-ai-config file from process.cwd() at runtime — on Vercel the file is
   materialized by scripts/write-zai-config.mjs during the build (from the
   ZAI_* env vars) and then bundled into each of these serverless functions.
   If the ZAI_* vars are not configured, the file doesn't exist and the
   include list is left empty so the build still succeeds. */
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

const outputFileTracingIncludes = existsSync("./.z-ai-config")
  ? Object.fromEntries(ZAI_ROUTES.map((route) => [route, ["./.z-ai-config"]]))
  : {};

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


