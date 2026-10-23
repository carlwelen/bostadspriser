import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// The repo keeps a single `.env` at the root (shared with the scraper). Next
// only reads env files from `web/`, so pull the root one in as a fallback;
// variables already set in the environment or in `web/.env*` win.
loadEnvConfig(path.resolve(__dirname, ".."));

const nextConfig: NextConfig = {};

export default nextConfig;
