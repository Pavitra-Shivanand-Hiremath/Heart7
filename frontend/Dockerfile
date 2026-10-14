# --- Build stage ---
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# Baked in at build time since Vite env vars are compiled into the static bundle.
ARG VITE_WS_URL=ws://localhost:8000
ENV VITE_WS_URL=$VITE_WS_URL

RUN npm run build

# --- Serve stage ---
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
