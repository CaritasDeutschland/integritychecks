FROM node:18 as build-deps
ARG FIXTURE_NAME=InconsistentChecks

WORKDIR /app
COPY ./$FIXTURE_NAME /app
ENV NODE_ENV=development
RUN yarn install
RUN yarn run build

# Nginx
FROM node:18
WORKDIR /app
COPY --from=build-deps /app/package.json ./package.json
COPY --from=build-deps /app/yarn.lock ./yarn.lock

ENV NODE_ENV=production
RUN yarn install

COPY --from=build-deps /app/dist ./dist
CMD ["yarn", "run", "start"]
