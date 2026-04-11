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
from routers import live, sessions, llm, voice


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

app.include_router(sessions.router)
app.include_router(llm.router)
app.include_router(live.router)
app.include_router(voice.router)


@app.get('/health')
async def health():
  return {
    'status': 'ok',
    'service': 'q-note',
    'version': '0.2.0',
    'deepgram_configured': bool(os.getenv('DEEPGRAM_API_KEY')),
    'openai_configured': bool(os.getenv('OPENAI_API_KEY')),
  }
