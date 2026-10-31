FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY server ./server
COPY public ./public
COPY index.html ./index.html
COPY config.example.json ./config.example.json
# Start from the safe template; deployment values can override it through .env.
COPY config.example.json ./config.json

RUN mkdir -p /app/data

EXPOSE 7778
VOLUME ["/app/data"]

CMD ["node", "server/index.mjs"]
