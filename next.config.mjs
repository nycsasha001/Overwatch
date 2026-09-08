import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Build a self-contained server for the container.
   *
   * Without this the image needs the whole node_modules tree — several hundred megabytes of it —
   * and a `npm ci` at boot. Standalone traces only what the server actually imports and writes a
   * `server.js` beside it, which is what the Dockerfile copies.
   */
  output: "standalone",
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
