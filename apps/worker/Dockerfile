# Build from the repository root: docker build -f apps/worker/Dockerfile -t propintel-worker .
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/
RUN npm ci --workspace worker --workspace @propintel/shared --include-workspace-root --ignore-scripts
COPY packages/shared packages/shared
COPY apps/worker apps/worker
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "start", "-w", "worker"]
