FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ ./packages/
COPY apps/ ./apps/
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm run build
EXPOSE 3000
CMD ["node", "apps/server/th-server/dist/index.js"]
