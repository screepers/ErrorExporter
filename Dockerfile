# syntax=docker/dockerfile:1

FROM node:16.9.0
ENV NODE_ENV=production

WORKDIR /usr/ErrorExporter
COPY ./ ./

# COPY ["package.json", "package-lock.json*", "./"]

RUN npm install --production

CMD [ "node", "errorsGetter/index.js" ]
