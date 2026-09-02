import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Turned off rather than relocated. Replay runs full-screen and puts controls in every corner —
  // account switcher bottom-left, trade panel bottom-right, toolbar along the top — so the badge
  // covered something wherever it sat. Nothing is lost: compile errors still stop the page with
  // Next's own overlay, and the server log records every one of them.
  devIndicators: false,
  turbopack: {
    resolveAlias: { "@": "./src" },
  },
  webpack: (config) => {
    config.resolve.alias = { ...(config.resolve.alias ?? {}), "@": path.join(dir, "src") };
    // src/lib/driver.ts resolves better-sqlite3 at runtime on purpose (it is optional), so the
    // bundler's "dependencies cannot be statically extracted" warning is expected, not a problem.
    config.module = { ...config.module, exprContextCritical: false, unknownContextCritical: false };
    config.ignoreWarnings = [...(config.ignoreWarnings ?? []), { module: /src[\\/]lib[\\/]driver\.ts/ }];
    return config;
  },
};

export default nextConfig;
