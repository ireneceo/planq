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
  # 목소리 데이터 보관기간 — 24개월 미사용 프로필 삭제(30일 전 알림) · 끝난 회의 화자 임베딩 7일 뒤 삭제
  import asyncio as _asyncio
  from services.voice_retention import loop as _voice_retention_loop
  _retention_task = _asyncio.create_task(_voice_retention_loop())
  yield
  _retention_task.cancel()
  logger.info('Q Note shutting down')


# API 문서(/docs·/redoc·/openapi.json)는 **켤 때만** 낸다 — 내부 주소까지 담긴 지도다(2026-10-09 보안점검).
#   «운영이면 끈다» 로 두면 운영 .env 에 그 표시가 없을 때 조용히 열린다(Fable 지적) → 기본 꺼짐, QNOTE_DOCS=1 일 때만.
_DOCS_OFF = os.getenv('QNOTE_DOCS') != '1'
app = FastAPI(title='Q Note', version='0.2.0', lifespan=lifespan,
              docs_url=None if _DOCS_OFF else '/docs', redoc_url=None if _DOCS_OFF else '/redoc',
              openapi_url=None if _DOCS_OFF else '/openapi.json')

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

# ★ 내부 전용 주소(/…/internal/…) 관문 — 한 곳 (2026-10-09 보안점검).
#   nginx 의 /qnote/ 가 이 서비스 전체를 바깥에 열어 두므로 internal 주소도 인터넷에서 닿았고, 키 하나만 지켰다.
#   ★ «같은 서버에서 왔나» 를 request.client.host 로만 보면 **거짓**이다 — nginx 도 127.0.0.1 에서 프록시한다.
#     그래서 nginx 가 반드시 붙이는 X-Real-IP / X-Forwarded-For 가 있으면 바깥 요청으로 본다(Node 의 직접 호출엔 없다).
#   키는 hmac.compare_digest 로 비교한다(Node utils/internalAuth.js 와 같은 두 겹).
import hmac as _hmac
from fastapi.responses import JSONResponse as _JSONResponse
_LOOPBACK = {'127.0.0.1', '::1', '::ffff:127.0.0.1'}

def internal_request_ok(request) -> bool:
  host = request.client.host if request.client else ''
  if host not in _LOOPBACK:
    return False
  if request.headers.get('x-real-ip') or request.headers.get('x-forwarded-for'):
    return False
  expected = os.environ.get('INTERNAL_API_KEY') or ''
  provided = request.headers.get('x-internal-api-key') or ''
  return bool(expected) and _hmac.compare_digest(provided.encode(), expected.encode())

@app.middleware('http')
async def _internal_gate(request, call_next):
  if '/internal/' in request.url.path and not internal_request_ok(request):
    return _JSONResponse(status_code=404, content={'detail': 'not found'})
  return await call_next(request)

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
