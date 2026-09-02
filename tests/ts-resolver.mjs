/**
 * Lets the plain-node test runner resolve the extensionless relative imports that the app's
 * bundler handles for it (./session → ./session.ts). Test-only; the app never loads this.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const direct = new URL(specifier, context.parentURL);
    if (!fs.existsSync(fileURLToPath(direct))) {
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        const candidate = new URL(specifier + ext, context.parentURL);
        if (fs.existsSync(fileURLToPath(candidate))) return next(specifier + ext, context);
      }
    }
  }
  return next(specifier, context);
}
