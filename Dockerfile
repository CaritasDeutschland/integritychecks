FROM node:18 as build-deps
ARG FIXTURE_NAME=InconsistentChecks

WORKDIR /app
COPY ./$FIXTURE_NAME /app
RUN npm install
RUN npm run build

# Nginx
FROM node:18
WORKDIR /app
COPY --from=build-deps /package.json /app/package.json
COPY --from=build-deps /yarn.lock /app/yarn.lock
COPY --from=build-deps /app/dist /app/dist
CMD ["npm", "run", "start"]
