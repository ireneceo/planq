import os
import logging
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

logging.basicConfig(
  level=logging.INFO,
  format='%(asctime)s [%(name)s] %(levelname)s - %(message)s'
)
logger = logging.getLogger('q-note')

from services.database import init_db
from routers import live, sessions, llm, voice, audio_upload


@asynccontextmanager
async def lifespan(app: FastAPI):
  await init_db()
  logger.info('Q Note started — DB initialized')
  yield
  logger.info('Q Note shutting down')


app = FastAPI(title='Q Note', version='0.2.0', lifespan=lifespan)

ALLOWED_ORIGINS = os.getenv(
  'ALLOWED_ORIGINS',
  'https://dev.planq.kr,http://localhost:5173'
).split(',')

app.add_middleware(
  CORSMiddleware,
  allow_origins=ALLOWED_ORIGINS,
  allow_credentials=True,
  allow_methods=['*'],
  allow_headers=['*'],
)

# 느린 요청 기록 — 메인 백엔드 middleware/requestTiming.js 와 같은 계약(경로의 숫자 id 는 :id, 쿼리·본문 없음).
#   «모든 기능 속도 체크» 를 실사용으로 한다(2026-10-04). WebSocket(/ws/live)은 http 가 아니라 여기 안 걸린다.
import re as _re
import time as _time
_SLOW_MS = int(os.getenv('SLOW_REQUEST_MS', '800'))
_slow_logger = logging.getLogger('q-note.slow')

@app.middleware('http')
async def _request_timing(request, call_next):
  t0 = _time.perf_counter()
  response = await call_next(request)
  ms = (_time.perf_counter() - t0) * 1000
  if ms >= _SLOW_MS:
    ct = response.headers.get('content-type', '')
    if not _re.search(r'event-stream|octet-stream|audio/|application/pdf', ct):
      # 값이 로그에 남지 않게 — 라우트가 잡혔으면 코드에 적힌 모양(/api/sessions/{session_id}),
      #   안 잡혔으면 앞의 고정 단어 두 개만. 실제 주소에서 «지울 것만 지우면» 사람 값이 샌다(메인 백엔드와 같은 계약).
      route = request.scope.get('route')
      if route is not None and getattr(route, 'path', None):
        path = str(route.path)[:160]
      else:
        head = []
        segs = [x for x in request.url.path.split('/') if x]
        for seg in segs:
          if len(head) >= 2 or not _re.fullmatch(r'[a-z][a-z_-]{0,29}', seg):
            break
          head.append(seg)
        path = '/' + '/'.join(head) + ('/…' if len(segs) > len(head) else '')
      _slow_logger.info('[slow] %s %s %s %dms', request.method, path, response.status_code, round(ms))
  return response


app.include_router(sessions.router)
app.include_router(llm.router)
app.include_router(live.router)
app.include_router(voice.router)
app.include_router(audio_upload.router)   # #383 녹음파일 업로드 → STT


@app.get('/health')
async def health():
  return {
    'status': 'ok',
    'service': 'q-note',
    'version': '0.2.0',
    'deepgram_configured': bool(os.getenv('DEEPGRAM_API_KEY')),
    'openai_configured': bool(os.getenv('OPENAI_API_KEY')),
  }
