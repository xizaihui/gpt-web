module.exports = {
  apps: [{
    name: 'chatgpt-web',
    script: 'build/index.mjs',
    cwd: '/opt/chatgpt-web/service',
    interpreter: 'node',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
    },
    error_file: '/tmp/chatgpt-web-pm2-error.log',
    out_file: '/tmp/chatgpt-web-pm2-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
}
