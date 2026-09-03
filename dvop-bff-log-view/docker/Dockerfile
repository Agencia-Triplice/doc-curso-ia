# build
FROM nexusrepository.bradesco.com.br:8500/ubi10_custom/nodejs-22:daily-update AS build
WORKDIR /opt/app-root/src
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
COPY static ./static
RUN npm run build && npm prune --omit=dev

# runtime
FROM nexusrepository.bradesco.com.br:8500/ubi10_custom/nodejs-22-minimal:daily-update
WORKDIR /opt/app-root/src
ENV NODE_ENV=production
COPY --from=build /opt/app-root/src/node_modules ./node_modules
COPY --from=build /opt/app-root/src/dist ./dist
COPY --from=build /opt/app-root/src/static ./static
RUN mkdir -p /opt/app-root/src/data && chown -R 1001:0 /opt/app-root/src && chmod -R g+rwX /opt/app-root/src

# usuário não-root explícito (a base UBI já define 1001; explícito para o scan ACS)
USER 1001

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:8080/health/live', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/main.js"]
