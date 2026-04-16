FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

EXPOSE 3000
ENV PORT=3000 NODE_ENV=production

CMD ["node","server.js"]
