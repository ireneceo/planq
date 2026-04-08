// PM2 필수 체크
if (process.env.pm_id === undefined) {
  console.error('This server must be run through PM2.');
  console.error('Usage: pm2 start ecosystem.config.js --only planq-dev-backend');
  process.exit(1);
}

// ROOT 실행 방지 — irene 유저로만 실행
if (process.getuid && process.getuid() === 0) {
  console.error('Do NOT run this server as root! Use irene user via PM2.');
  process.exit(1);
}

require('dotenv').config();

// JWT_SECRET 필수 체크
if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET environment variable is not set!');
  process.exit(1);
}

const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const { setupSecurity } = require('./middleware/security');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const server = http.createServer(app);

// Socket.IO with authentication
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true }
});

// Socket.IO 인증 미들웨어
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
  if (!token) {
    return next(new Error('Authentication required'));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId || decoded.id;
    next();
  } catch (err) {
    return next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id, 'userId:', socket.userId);
  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

app.set('io', io);

// Security
setupSecurity(app);

// Body parser + Cookie parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'planq', timestamp: new Date().toISOString() });
});

// Load models (initializes associations)
require('./models');

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/businesses', require('./routes/businesses'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/files', require('./routes/files'));
app.use('/api/invoices', require('./routes/invoices'));

// Error handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 3003;
server.listen(PORT, () => {
  console.log(`PlanQ server running on port ${PORT} (${process.env.NODE_ENV})`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
