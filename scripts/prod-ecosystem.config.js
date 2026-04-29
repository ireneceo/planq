// PlanQ 운영(prod) PM2 설정
//
// 등록:
//   pm2 start /opt/planq/scripts/prod-ecosystem.config.js
//   pm2 save
//   pm2 startup    # 첫 운영 진입 시 1회
//
// 무중단 재배포 (deploy-prod.sh 가 호출):
//   pm2 reload /opt/planq/scripts/prod-ecosystem.config.js --only planq-prod-backend
//
// 운영 디렉터리 구조 (deploy-prod.sh 가 생성):
//   /opt/planq/prod-backend/       (Node.js Express, port 3002)
//   /opt/planq/prod-qnote/         (Python FastAPI, port 8001)
//   /opt/planq/prod-frontend-build/ (정적 빌드 산출물)
//
// 로그:
//   /opt/planq/logs/prod-backend-{out,error}.log
//   /opt/planq/logs/prod-qnote-{out,error}.log

module.exports = {
  apps: [
    {
      name: 'planq-prod-backend',
      script: './server.js',
      cwd: '/opt/planq/prod-backend',
      instances: 1,                // 추후 cluster 모드 전환 가능
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: 10000,           // 10s 이상 떠있어야 안정으로 인정 (dev 5s 보다 보수적)
      restart_delay: 4000,
      watch: false,
      max_memory_restart: '1G',    // 운영은 dev 보다 여유 있게
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
      error_file: '/opt/planq/logs/prod-backend-error.log',
      out_file: '/opt/planq/logs/prod-backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'planq-prod-qnote',
      script: '/opt/planq/prod-qnote/venv/bin/uvicorn',
      args: 'main:app --host 0.0.0.0 --port 8001 --app-dir /opt/planq/prod-qnote',
      interpreter: '/opt/planq/prod-qnote/venv/bin/python',
      cwd: '/opt/planq/prod-qnote',
      autorestart: true,
      max_restarts: 10,
      min_uptime: 10000,
      restart_delay: 4000,
      watch: false,
      max_memory_restart: '2G',    // STT/LLM 모델 메모리 여유
      kill_timeout: 10000,
      env: {
        ENV: 'production',
        PORT: '8001',
      },
      error_file: '/opt/planq/logs/prod-qnote-error.log',
      out_file: '/opt/planq/logs/prod-qnote-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
