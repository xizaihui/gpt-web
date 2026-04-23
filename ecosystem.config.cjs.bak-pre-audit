module.exports = {
  apps: [{
    name: "chatgpt-web",
    script: "build/index.mjs",
    cwd: "/opt/chatgpt-web/service",
    interpreter: "node",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "500M",
    env: {
      NODE_ENV: "production",
      CLEWDR_BASE_URL: "http://38.150.32.190:8484",
      CLEWDR_API_KEY: "5Un8tWFybBsBL3e9QV3KPbguLy3akgJ5zwynwQtTv8Cc3NbgPJCKrcXn9ENke6uJ",
      CLEWDR_ADMIN_KEY: "HrVJGgfJjvzKTn4FMgyLPagdRq8KA7s6gLeuJFgsp6SnjdwTkG4hWjLMFj8kfD8Y",
    },
    error_file: "/tmp/chatgpt-web-pm2-error.log",
    out_file: "/tmp/chatgpt-web-pm2-out.log",
    merge_logs: true,
    log_date_format: "YYYY-MM-DD HH:mm:ss",
  }],
}
