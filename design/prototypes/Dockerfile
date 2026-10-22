FROM node:22-alpine AS build
WORKDIR /preview/prototypes
COPY prototypes/package.json prototypes/package-lock.json ./
RUN npm ci
COPY prototypes/ ./
COPY tokens/ ../tokens/
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /preview/prototypes/dist /usr/share/nginx/html
COPY prototypes/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
