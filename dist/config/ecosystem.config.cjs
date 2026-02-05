const path = require('path');

module.exports = {
  apps: [
    {
      name: 'task-scheduler',
      script: './server/scheduler.js',
      cwd: path.resolve(__dirname, '..'),
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_memory_restart: '500M',
      error_file: './logs/scheduler-error.log',
      out_file: './logs/scheduler-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: 'config-server',
      script: './server/config-server.js',
      cwd: path.resolve(__dirname, '..'),
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_memory_restart: '200M',
      error_file: './logs/config-error.log',
      out_file: './logs/config-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: 'web-server',
      script: './server/static-server.js',
      cwd: path.resolve(__dirname, '..'),
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_memory_restart: '100M',
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
}
