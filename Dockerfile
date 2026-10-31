FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY server ./server
COPY public ./public
COPY index.html ./index.html

RUN mkdir -p /app/data
# Start with no channels configured. Environment variables enable the selected chats.
RUN printf '{}\n' > /app/data/config.json

EXPOSE 7778
VOLUME ["/app/data"]

CMD ["node", "server/index.mjs"]
