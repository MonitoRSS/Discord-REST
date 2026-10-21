FROM node:24-alpine AS build

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . ./
