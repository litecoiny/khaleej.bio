FROM node:22-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY server ./server
COPY assets ./assets
COPY *.html ./
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    TRUST_PROXY=1
EXPOSE 8080
# Host volumes (Railway, Render) are mounted owned by root: fix ownership,
# then drop to the unprivileged node user.
CMD ["sh", "-c", "mkdir -p \"$DATA_DIR\" && chown -R node:node \"$DATA_DIR\" && exec su-exec node node --disable-warning=ExperimentalWarning server.js"]
