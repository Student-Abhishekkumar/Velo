# Use Node.js 20 on Alpine for a lightweight, secure base
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install system dependencies:
# - ffmpeg: for media processing
# - yt-dlp: available in alpine community repo
# - python3: required by yt-dlp (some features)
RUN apk add --no-cache \
    ffmpeg \
    yt-dlp \
    python3 \
    py3-pip

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the application code
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1

# Expose the port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
