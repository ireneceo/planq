module.exports = {
  apps: [
    {
      name: 'planq-dev-backend',
      script: './server.js',
      cwd: '/opt/planq/dev-backend',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: 5000,
      restart_delay: 4000,
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'development',
        PORT: 3003
      },
      error_file: '/opt/planq/logs/dev-backend-error.log',
      out_file: '/opt/planq/logs/dev-backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    }
  ]
};
