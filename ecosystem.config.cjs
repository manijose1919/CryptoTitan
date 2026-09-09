module.exports = {
  apps: [
    {
      name: 'canuck-node',
      script: 'serverV2.ts',
      interpreter: 'node',
      node_args: '--experimental-strip-types',
      cwd: '/opt/trading-bot',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'production',
        PORT: 3033,
        V2_MODE: 'paper',
        // Dual live interlock: live requires V2_MODE=live AND this = yes.
        V2_LIVE_CONFIRMED: 'no',
        // FIL/ICP is outside the Canadian deployment allowlist.
        PAIRS_MODE: 'off',
      },
      // Logging
      error_file: '/opt/trading-bot/logs/error.log',
      out_file: '/opt/trading-bot/logs/output.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Restart policy
      exp_backoff_restart_delay: 1000,
      max_restarts: 50,
      restart_delay: 3000,
    }
  ]
};
