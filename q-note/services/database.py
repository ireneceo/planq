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
    ('capture_mode', "TEXT NOT NULL DEFAULT 'microphone'"),  # 'microphone' | 'web_conference'
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

  # documents: 파이프라인 통합 (파일 + URL 공통)
  doc_cols = [
    ('source_type', "TEXT NOT NULL DEFAULT 'file'"),  # 'file' | 'url'
    ('source_url', 'TEXT'),                           # source_type='url' 일 때만
    ('title', 'TEXT'),                                # 추출된 문서 제목 (없으면 original_filename)
    ('error_message', 'TEXT'),                        # status='failed' 일 때 사유
    ('indexed_at', 'TEXT'),                           # 인덱싱 완료 시각
  ]
  for col, typ in doc_cols:
    if not await _column_exists(db, 'documents', col):
      await db.execute(f"ALTER TABLE documents ADD COLUMN {col} {typ}")

  # documents.filename 은 NOT NULL 이지만 URL 은 파일이 아님 → 가상 파일명 사용
  # (마이그레이션 불필요, 라우터에서 url_<hex>.url 형태로 생성)

  # detected_questions: 답변 찾기 결과 캐시용
  dq_cols = [
    ('matched_qa_id', 'INTEGER'),       # qa_pairs 에서 매칭된 경우 해당 ID
    ('answer_tier', 'TEXT'),            # 'custom' | 'generated' | 'rag' | 'general' | NULL
  ]
  for col, typ in dq_cols:
    if not await _column_exists(db, 'detected_questions', col):
      await db.execute(f"ALTER TABLE detected_questions ADD COLUMN {col} {typ}")

  # sessions: 사용자 프로필 스냅샷 (답변 생성 시 "나"로서 답하기 위한 정보)
  session_profile_cols = [
    ('user_name', 'TEXT'),              # 사용자 이름
    ('user_bio', 'TEXT'),               # 자기소개
    ('user_expertise', 'TEXT'),         # 전문 분야
    ('user_organization', 'TEXT'),      # 회사/조직
    ('user_job_title', 'TEXT'),         # 직책
    # 답변 수준 제어 (프로필 스냅샷 + 회의별 override)
    ('user_language_levels', 'TEXT'),   # JSON: { ko: {reading,speaking,listening,writing}, en: ... }
    ('user_expertise_level', 'TEXT'),   # 'layman' | 'practitioner' | 'expert'
    ('meeting_answer_style', 'TEXT'),   # 이번 회의 답변 스타일 자유 입력
    ('meeting_answer_length', 'TEXT'),  # 'short' | 'medium' | 'long'
    ('keywords', 'TEXT'),               # JSON string[] — STT 보정용 어휘 사전
  ]
  for col, typ in session_profile_cols:
    if not await _column_exists(db, 'sessions', col):
      await db.execute(f"ALTER TABLE sessions ADD COLUMN {col} {typ}")

  # qa_pairs: 임베딩 + priority 플래그 + 1문장 답변 + 키워드
  qa_extra_cols = [
    ('embedding', 'BLOB'),              # OpenAI text-embedding-3-small (1536 × float32)
    ('is_priority', 'INTEGER NOT NULL DEFAULT 0'),  # 1 = 최우선 Q&A (별도 업로드 분리)
    ('short_answer', 'TEXT'),           # 1문장 버전 — meeting_answer_length='short' 일 때 우선 사용
    ('keywords', 'TEXT'),               # JSON string[] — Q&A 별 핵심 키워드 (FTS5 인덱스에 합침)
    ('source_filename', 'TEXT'),        # 업로드 원본 파일명 (수동 입력 시 NULL)
  ]
  for col, typ in qa_extra_cols:
    if not await _column_exists(db, 'qa_pairs', col):
      await db.execute(f"ALTER TABLE qa_pairs ADD COLUMN {col} {typ}")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_qa_priority ON qa_pairs(session_id, is_priority DESC)")

  # qa_pairs FTS5: keywords 를 question_text 에 합쳐 인덱싱.
  # 기존 트리거는 question_text 만 인덱싱 — keywords 를 합친 버전으로 rebuild 필요.
  # 전략: 기존 트리거 유지 + 별도 UPDATE 트리거로 keywords 변경 시 재인덱싱.
  # 여기서는 INSERT 시점에 keywords 가 포함된 복합 텍스트를 FTS5 에 넣도록 트리거 교체.
  await db.execute('DROP TRIGGER IF EXISTS qa_fts_ai')
  await db.execute('DROP TRIGGER IF EXISTS qa_fts_ad')
  await db.execute('DROP TRIGGER IF EXISTS qa_fts_au')
  await db.executescript('''
    CREATE TRIGGER IF NOT EXISTS qa_fts_ai AFTER INSERT ON qa_pairs BEGIN
      INSERT INTO qa_pairs_fts(rowid, question_text, answer_text)
      VALUES (new.id, new.question_text || ' ' || COALESCE(new.keywords, ''), COALESCE(new.answer_text, ''));
    END;
    CREATE TRIGGER IF NOT EXISTS qa_fts_ad AFTER DELETE ON qa_pairs BEGIN
      INSERT INTO qa_pairs_fts(qa_pairs_fts, rowid, question_text, answer_text)
      VALUES ('delete', old.id, old.question_text || ' ' || COALESCE(old.keywords, ''), COALESCE(old.answer_text, ''));
    END;
    CREATE TRIGGER IF NOT EXISTS qa_fts_au AFTER UPDATE ON qa_pairs BEGIN
      INSERT INTO qa_pairs_fts(qa_pairs_fts, rowid, question_text, answer_text)
      VALUES ('delete', old.id, old.question_text || ' ' || COALESCE(old.keywords, ''), COALESCE(old.answer_text, ''));
      INSERT INTO qa_pairs_fts(rowid, question_text, answer_text)
      VALUES (new.id, new.question_text || ' ' || COALESCE(new.keywords, ''), COALESCE(new.answer_text, ''));
    END;
  ''')
  # 기존 데이터 재인덱싱 — keywords 컬럼 신규 추가 후 FTS5 와 sync 맞춤
  try:
    await db.execute("INSERT INTO qa_pairs_fts(qa_pairs_fts) VALUES('rebuild')")
  except Exception:
    pass

  # voice_fingerprints: 단일 언어(user_id PK) → 다국어(UNIQUE user_id + language) 로 전환
  # 기존 Table 에 language 컬럼이 없으면 migration 수행
  if not await _column_exists(db, 'voice_fingerprints', 'language'):
    # 기존 테이블을 rename 하고 새로 만들어 데이터 이관 (user_id PK 를 버리고 새 UNIQUE 추가)
    await db.execute("ALTER TABLE voice_fingerprints RENAME TO voice_fingerprints_v1")
    await db.execute("""
      CREATE TABLE voice_fingerprints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        language TEXT NOT NULL,
        embedding BLOB NOT NULL,
        sample_seconds REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (user_id, language)
      )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_voice_fingerprints_user ON voice_fingerprints(user_id)")
    # 기존 row 는 users.language 를 모르는 상태이므로 'unknown' 태그로 보존 (사용자가 확인 후 재등록)
    await db.execute("""
      INSERT INTO voice_fingerprints (user_id, language, embedding, sample_seconds, created_at, updated_at)
      SELECT user_id, 'unknown', embedding, sample_seconds, created_at, updated_at
      FROM voice_fingerprints_v1
    """)
    await db.execute("DROP TABLE voice_fingerprints_v1")


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

-- 사용자 음성 핑거프린트 (Resemblyzer 256차원 임베딩)
-- 다국어 지원: 1 user → N languages (각 언어별 embedding).
-- 매칭 시 저장된 모든 embedding 과 비교해 max similarity 사용.
CREATE TABLE IF NOT EXISTS voice_fingerprints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  language TEXT NOT NULL,            -- ISO 639-1 ('ko', 'en', ...)
  embedding BLOB NOT NULL,           -- 256 × float32 little-endian = 1024 bytes
  sample_seconds REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, language)
);

CREATE INDEX IF NOT EXISTS idx_voice_fingerprints_user ON voice_fingerprints(user_id);

-- 세션별 화자 임베딩 (배치 클러스터링용)
-- 회의 종료 시점에 dg_speaker_id 별 누적 오디오로 임베딩을 계산해 저장.
CREATE TABLE IF NOT EXISTS speaker_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  speaker_id INTEGER NOT NULL UNIQUE,   -- speakers.id
  embedding BLOB NOT NULL,
  sample_seconds REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON DELETE CASCADE
);

-- ─── Q&A 지식 베이스 ───
-- 고객 직접 등록(custom) + AI 사전 생성(generated) Q&A 쌍.
-- 답변 찾기 시 우선순위: custom > generated > RAG > general AI
CREATE TABLE IF NOT EXISTS qa_pairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'custom',   -- 'custom' | 'generated'
  category TEXT,                           -- 선택적 분류
  question_text TEXT NOT NULL,
  answer_text TEXT,                         -- custom: 고객 입력. generated: AI 생성
  answer_translation TEXT,                 -- 번역된 답변
  answer_sources TEXT,                     -- JSON: [{"chunk_id":N, "snippet":"..."}]
  parent_id INTEGER,                       -- 꼬리질문이면 원래 질문 ID
  confidence TEXT,                         -- generated만: 'high' | 'medium' | 'low'
  is_reviewed INTEGER DEFAULT 0,           -- 고객 확인/수정 → 1 (custom급 신뢰도)
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES qa_pairs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_qa_session ON qa_pairs(session_id);
CREATE INDEX IF NOT EXISTS idx_qa_source ON qa_pairs(session_id, source);
CREATE INDEX IF NOT EXISTS idx_qa_parent ON qa_pairs(parent_id);

-- FTS5: 질문+답변 전문 검색 (매칭용)
CREATE VIRTUAL TABLE IF NOT EXISTS qa_pairs_fts USING fts5(
  question_text,
  answer_text,
  content='qa_pairs',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS qa_fts_ai AFTER INSERT ON qa_pairs BEGIN
  INSERT INTO qa_pairs_fts(rowid, question_text, answer_text)
  VALUES (new.id, new.question_text, COALESCE(new.answer_text, ''));
END;

CREATE TRIGGER IF NOT EXISTS qa_fts_ad AFTER DELETE ON qa_pairs BEGIN
  INSERT INTO qa_pairs_fts(qa_pairs_fts, rowid, question_text, answer_text)
  VALUES ('delete', old.id, old.question_text, COALESCE(old.answer_text, ''));
END;

CREATE TRIGGER IF NOT EXISTS qa_fts_au AFTER UPDATE ON qa_pairs BEGIN
  INSERT INTO qa_pairs_fts(qa_pairs_fts, rowid, question_text, answer_text)
  VALUES ('delete', old.id, old.question_text, COALESCE(old.answer_text, ''));
  INSERT INTO qa_pairs_fts(rowid, question_text, answer_text)
  VALUES (new.id, new.question_text, COALESCE(new.answer_text, ''));
END;
"""
