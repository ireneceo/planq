const successResponse = (res, data, message = 'Success', statusCode = 200) => {
  const response = { success: true, data };
  if (message && message !== 'Success') response.message = message;
  return res.status(statusCode).json(response);
};

const errorResponse = (res, message = 'Internal server error', statusCode = 500, code = null) => {
  const response = { success: false, message };
  if (code) response.code = code;
  return res.status(statusCode).json(response);
};

const errorHandler = (err, req, res, next) => {
  console.error('API Error:', {
    error: err.message,
    url: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';

  if (err.name === 'SequelizeValidationError') {
    statusCode = 400;
    message = err.errors.map(e => e.message).join(', ');
  } else if (err.name === 'SequelizeUniqueConstraintError') {
    statusCode = 409;
    message = 'Resource already exists';
  } else if (err.name === 'SequelizeForeignKeyConstraintError') {
    statusCode = 400;
    message = 'Invalid reference to related resource';
  }

  if (process.env.NODE_ENV === 'production') {
    message = statusCode === 500 ? 'Internal server error' : message;
  }

  return res.status(statusCode).json({ success: false, message });
};

module.exports = { successResponse, errorResponse, errorHandler };
