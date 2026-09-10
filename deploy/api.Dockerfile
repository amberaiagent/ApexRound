FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY api ./api
COPY dist/lib ./dist/lib
COPY scripts/lib ./scripts/lib
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8082 APEX_DATABASE=/data/arena.sqlite APEX_TRUST_PROXY=1
USER node
EXPOSE 8082
CMD ["node", "api/main.js"]
