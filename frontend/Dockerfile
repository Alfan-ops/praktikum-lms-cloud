# Stage 1: Build the React application
FROM node:18-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
# Use the build script defined in your package.json
RUN npm run build

# Stage 2: Serve the built application with Nginx
FROM nginx:stable-alpine
# Copy the static assets from the build stage
COPY --from=build /app/build /usr/share/nginx/html
# Copy a custom Nginx config if needed (optional)
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

