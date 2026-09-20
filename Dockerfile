# Production image for the news platform. See docs/deployment.md.
#
# Debian slim rather than Alpine on purpose: sharp and its libvips
# dependency are far less trouble against glibc than against musl, and
# image re-encoding is a security control here (it strips EXIF and
# anything embedded in an upload), not an optional nicety.

# --- dependencies ------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# ci, not install: builds from the lockfile exactly, and fails rather than
# quietly resolving something new.
RUN npm ci

# --- build -------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The Prisma client is generated, not committed, so nothing compiles
# without this.
RUN npx prisma generate

# No database is needed to build. The two prerendered pages that query one
# fall back to rendering without it — see src/lib/buildSafe.ts — so an
# image can be built before the database it will talk to exists, and a
# build machine never needs production credentials. These two are only
# here because the Prisma client and Auth.js refuse to initialise without
# something well-formed; neither is ever connected to or used.
ENV DATABASE_URL="mysql://build:build@127.0.0.1:59999/build"
ENV AUTH_SECRET="build-time-placeholder-never-used-at-runtime"
RUN npm run build

# --- migrations --------------------------------------------------------
# A separate image with the Prisma CLI and the schema, so migrations run as
# their own step rather than on every app boot. Racing two app containers
# through the same migration is a good way to corrupt a deployment.
FROM node:22-bookworm-slim AS migrator
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma7.config.ts ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY tsconfig.json ./
# The seed and bootstrap-staff scripts import the generated Prisma client,
# which is generated rather than committed — without this they fail on a
# missing module rather than doing anything useful.
RUN npx prisma generate
CMD ["npx", "prisma", "migrate", "deploy"]

# --- runtime -----------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
# Next prints a version-check notice otherwise; a server has no use for it.
ENV NEXT_TELEMETRY_DISABLED=1

# ffmpeg re-encodes uploaded video the way sharp re-encodes images:
# normalising codecs so a phone's .mov plays outside Safari, and stripping
# the source metadata, which on a phone recording includes where it was
# filmed. Without it the app stores the original instead — see
# src/lib/transcode.ts — so removing this line degrades video handling
# rather than breaking the build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
ENV FFMPEG_PATH=/usr/bin/ffmpeg

# Never root. A remote code execution bug in any dependency then lands as
# an unprivileged user with no package manager to hand.
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# standalone carries the server and only the modules the build traced as
# reachable. Static assets and public/ are not included in it and have to
# be copied alongside.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Only used when S3 is not configured. A named volume is mounted here in
# docker-compose.yml, because a container's own filesystem does not
# survive a redeploy and uploads would silently vanish.
RUN mkdir -p /app/.local-uploads && chown nextjs:nodejs /app/.local-uploads

USER nextjs

EXPOSE 3000
ENV PORT=3000
# Binds inside the container only. The host publishes this to 127.0.0.1,
# so the only way in is through the reverse proxy — see the note about
# X-Forwarded-For in docs/deployment.md, which is a real vulnerability if
# the port is reachable directly.
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
