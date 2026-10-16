import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl loads i18n/request.ts; there is no locale segment in the URL.
const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
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
