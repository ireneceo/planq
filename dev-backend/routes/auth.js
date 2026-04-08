const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');

// Login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return errorResponse(res, 'Email and password required', 400);
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return errorResponse(res, 'Invalid email or password', 401);
    }

    if (user.status !== 'active') {
      return errorResponse(res, 'Account suspended', 403);
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return errorResponse(res, 'Invalid email or password', 401);
    }

    await user.update({ last_login_at: new Date() });

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    successResponse(res, {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        platform_role: user.platform_role
      }
    }, 'Login successful');
  } catch (error) {
    next(error);
  }
});

// Register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name, phone } = req.body;
    if (!email || !password || !name) {
      return errorResponse(res, 'Email, password, and name required', 400);
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return errorResponse(res, 'Email already registered', 409);
    }

    const password_hash = await bcrypt.hash(password, 12);
    const user = await User.create({ email, password_hash, name, phone });

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    successResponse(res, {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        platform_role: user.platform_role
      }
    }, 'Registration successful', 201);
  } catch (error) {
    next(error);
  }
});

// Get current user
router.get('/me', authenticateToken, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password_hash'] }
    });
    successResponse(res, user);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
