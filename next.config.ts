import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl loads i18n/request.ts; there is no locale segment in the URL.
const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  // Phones reach `pnpm dev` through this Tailscale host; Next blocks dev resources requested from unlisted hosts.
  allowedDevOrigins: ["macbook-pro-4.taildc37b1.ts.net"],
  // Without this, `next dev` run by an AI agent appends its own block to AGENTS.md, the team's rules file.
  agentRules: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
