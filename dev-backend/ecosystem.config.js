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
      // 2026-11-08 — 힙 상한을 PM2 재시작 선(512M) 아래로. 안 걸면 V8 기본 상한이 약 2GB 라
      //   큰 목록 요청(예: all-files 1회 ≈ +15MB 쓰레기)이 쌓여도 GC 를 미루다가 PM2 가 먼저 죽였다
      //   (재시작 137회 · 실측: 20회 호출 RSS 252→515MB, 강제 GC 하면 453→211MB = 누수 아님).
      //   384 + 코드·버퍼 ≈ 100MB 가 512 안에 든다. 바꾸면 pm2 delete 후 이 파일로 다시 start 해야 먹는다(reload 는 node_args 를 안 읽음).
      node_args: '--max-old-space-size=384',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'development',
        PORT: 3003
      },
      error_file: '/opt/planq/logs/dev-backend-error.log',
      out_file: '/opt/planq/logs/dev-backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    },
    {
      // Q Note (FastAPI/uvicorn) — 보안 하드닝(C1 트랙A): 127.0.0.1 바인드로 인터넷 직접 노출 차단.
      // nginx가 /qnote/ → localhost:8000 프록시, Node→q-note도 localhost 경유라 내부통신 무해.
      // .env 는 main.py의 load_dotenv()가 cwd(/opt/planq/q-note)에서 자체 로드 (PM2 env 비의존).
      name: 'planq-qnote',
      script: '/opt/planq/q-note/venv/bin/uvicorn',
      interpreter: '/opt/planq/q-note/venv/bin/python',
      args: 'main:app --host 127.0.0.1 --port 8000 --app-dir /opt/planq/q-note',
      cwd: '/opt/planq/q-note',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: 5000,
      restart_delay: 4000,
      watch: false,
      // 2026-10-05 512M → 2G — 목소리 인코더(torch)를 한 번 올리면 RSS 94MB → 517MB 로 512M 를 넘어 회의 도중
      //   PM2 가 재시작했다(진행 중 녹음 전부 끊김). 운영 설정(scripts/prod-ecosystem.config.js)과 같은 2G.
      max_memory_restart: '2G',
      kill_timeout: 5000,
      error_file: '/opt/planq/logs/qnote-error.log',
      out_file: '/opt/planq/logs/qnote-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    }
  ]
};
