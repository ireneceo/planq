import aiosqlite
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'qnote.db')


async def get_db():
  async with connect() as db:
    db.row_factory = aiosqlite.Row
    yield db


def connect():
  """
  Returns an aiosqlite connection context manager with foreign keys enabled.
  Use in place of `aiosqlite.connect(DB_PATH)` everywhere.
  """
  class _Ctx:
    async def __aenter__(self):
      self._db = await aiosqlite.connect(DB_PATH)
      await self._db.execute('PRAGMA foreign_keys = ON')
      return self._db
    async def __aexit__(self, exc_type, exc, tb):
      await self._db.close()
  return _Ctx()


async def init_db():
  os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
  async with connect() as db:
    await db.executescript(SCHEMA_SQL)
    await _run_migrations(db)
    await db.commit()


async def _column_exists(db, table: str, column: str) -> bool:
  async with db.execute(f"PRAGMA table_info({table})") as cur:
    rows = await cur.fetchall()
  return any(row[1] == column for row in rows)


async def _run_migrations(db):
  # sessions: B-3 회의 준비 정보
  session_cols = [
    ('brief', 'TEXT'),
    ('participants', 'TEXT'),                  # JSON [{name, role}]
    ('urls', 'TEXT'),                          # JSON [{url, status, fetched_text}]
    ('meeting_languages', 'TEXT'),             # JSON ["en","ko"]
    ('translation_language', 'TEXT'),
    ('answer_language', 'TEXT'),
    ('pasted_context', 'TEXT'),                # 회의 자료로 붙여넣은 텍스트
  ]
  for col, typ in session_cols:
    if not await _column_exists(db, 'sessions', col):
      await db.execute(f"ALTER TABLE sessions ADD COLUMN {col} {typ}")

  # utterances: 화자 FK
  if not await _column_exists(db, 'utterances', 'speaker_id'):
    await db.execute(
      "ALTER TABLE utterances ADD COLUMN speaker_id INTEGER REFERENCES speakers(id) ON DELETE SET NULL"
    )

  # documents: 세션 소속 (전역 자료와 세션별 자료 구분)
  if not await _column_exists(db, 'documents', 'session_id'):
    await db.execute(
      "ALTER TABLE documents ADD COLUMN session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE"
    )
    await db.execute("CREATE INDEX IF NOT EXISTS idx_documents_session ON documents(session_id)")


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Session',
  language TEXT NOT NULL DEFAULT 'multi',
  duration_seconds INTEGER DEFAULT 0,
  utterance_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'recording',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_business ON sessions(business_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS utterances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  speaker TEXT DEFAULT 'unknown',
  original_text TEXT NOT NULL,
  translated_text TEXT,
  original_language TEXT,
  is_question INTEGER NOT NULL DEFAULT 0,
  is_final INTEGER NOT NULL DEFAULT 1,
  start_time REAL,
  end_time REAL,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_utterances_session ON utterances(session_id);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT,
  chunk_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_documents_business ON documents(business_id);

CREATE TABLE IF NOT EXISTS document_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  business_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_business ON document_chunks(business_id);

CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
  content,
  content='document_chunks',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON document_chunks BEGIN
  INSERT INTO document_chunks_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON document_chunks BEGIN
  INSERT INTO document_chunks_fts(document_chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;

CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL UNIQUE,
  key_points TEXT,
  full_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS detected_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  utterance_id INTEGER,
  question_text TEXT NOT NULL,
  answer_text TEXT,
  answer_sources TEXT,
  answered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (utterance_id) REFERENCES utterances(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_questions_session ON detected_questions(session_id);

CREATE TABLE IF NOT EXISTS speakers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  deepgram_speaker_id INTEGER NOT NULL,
  participant_name TEXT,
  is_self INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, deepgram_speaker_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_speakers_session ON speakers(session_id);
"""
