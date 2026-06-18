// Q위키 (Q Wiki) 스키마 보강 — sequelize sync 가 못 만드는 부분.
//  1) help_articles FULLTEXT(ngram) 인덱스 — 한글/영문 키워드 검색
//  2) kb_chunks 재사용 준비 — business_id/kb_document_id nullable + source_type/source_id
//     (Q위키 본문 임베딩을 kb_chunks 에 source_type='wiki', source_id=article.id 로 저장.
//      플랫폼 공통 콘텐츠라 business_id 없음.)
// 멱등 — 여러 번 실행해도 안전. node setup-wiki-schema.js
require('dotenv').config();
const { sequelize } = require('./config/database');

const DB = process.env.DB_NAME || 'planq_dev_db';

async function columnExists(table, column) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = :db AND TABLE_NAME = :table AND COLUMN_NAME = :column LIMIT 1`,
    { replacements: { db: DB, table, column } }
  );
  return rows.length > 0;
}

async function indexExists(table, indexName) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = :db AND TABLE_NAME = :table AND INDEX_NAME = :index LIMIT 1`,
    { replacements: { db: DB, table, index: indexName } }
  );
  return rows.length > 0;
}

async function run() {
  await sequelize.authenticate();
  console.log('Connected to', DB);

  // 1) FULLTEXT(ngram) on help_articles
  if (await indexExists('help_articles', 'ft_help_articles')) {
    console.log('· help_articles FULLTEXT 이미 존재 — skip');
  } else {
    await sequelize.query(
      `ALTER TABLE help_articles
       ADD FULLTEXT INDEX ft_help_articles (title_ko, summary_ko, title_en, summary_en) WITH PARSER ngram`
    );
    console.log('✓ help_articles FULLTEXT(ngram) 생성');
  }

  // 2) kb_chunks — business_id / kb_document_id nullable (Q위키 chunk 는 business 없음)
  await sequelize.query('ALTER TABLE kb_chunks MODIFY COLUMN business_id INT NULL');
  console.log('✓ kb_chunks.business_id NULL 허용');
  await sequelize.query('ALTER TABLE kb_chunks MODIFY COLUMN kb_document_id INT NULL');
  console.log('✓ kb_chunks.kb_document_id NULL 허용');

  // source_type — 'kb'(기존 대화 자료) / 'wiki'(Q위키 article). 기존 row 는 'kb'.
  if (await columnExists('kb_chunks', 'source_type')) {
    console.log('· kb_chunks.source_type 이미 존재 — skip');
  } else {
    await sequelize.query(
      `ALTER TABLE kb_chunks ADD COLUMN source_type ENUM('kb','wiki') NOT NULL DEFAULT 'kb' AFTER kb_document_id`
    );
    console.log('✓ kb_chunks.source_type 추가 (default kb)');
  }
  // source_id — source_type='wiki' 일 때 help_articles.id
  if (await columnExists('kb_chunks', 'source_id')) {
    console.log('· kb_chunks.source_id 이미 존재 — skip');
  } else {
    await sequelize.query(
      `ALTER TABLE kb_chunks ADD COLUMN source_id INT NULL AFTER source_type`
    );
    console.log('✓ kb_chunks.source_id 추가');
  }
  if (await indexExists('kb_chunks', 'kb_chunks_source')) {
    console.log('· kb_chunks_source 인덱스 이미 존재 — skip');
  } else {
    await sequelize.query(
      `ALTER TABLE kb_chunks ADD INDEX kb_chunks_source (source_type, source_id)`
    );
    console.log('✓ kb_chunks_source 인덱스 추가');
  }

  console.log('\n완료.');
  process.exit(0);
}

run().catch((err) => {
  console.error('setup-wiki-schema 실패:', err.message);
  process.exit(1);
});
