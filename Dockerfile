# Overwatch — production image.
#
# Two things about this app drive the whole file:
#
#   1. It keeps everything in SQLite files on disk. That is why the runtime stage declares a volume
#      at /data and TJ_DATA_DIR points there — without a mounted volume your journal is wiped on
#      every deploy.
#   2. better-sqlite3 is an *optional* dependency with a fallback to Node's built-in `node:sqlite`.
#      So no compiler is installed here: if the prebuilt binary does not match, the app still boots
#      on the fallback rather than failing the build.

# ---------------------------------------------------------------- dependencies
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` rather than `npm install`: it installs exactly the lockfile, so the image cannot end up
# with a different dependency tree than the one that was tested.
RUN npm ci

# --------------------------------------------------------------------- build
FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholders only. The real values are injected at run time by the host, never baked into the
# image — an image carrying secrets is a secret in every registry that ever holds a copy.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# -------------------------------------------------------------------- runtime
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# The mounted volume. Everything the app stores lives under here.
ENV TJ_DATA_DIR=/data

# Runs as a non-root user, so a compromise inside the container is not a compromise of it.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs \
 && mkdir -p /data \
 && chown -R nextjs:nodejs /data

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
