// EmailMessage — 스레드 안 개별 메시지 (Q Mail M1)
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class EmailMessage extends Model {}

EmailMessage.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  thread_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'email_threads', key: 'id' }, onDelete: 'CASCADE' },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  direction: { type: DataTypes.ENUM('inbound', 'outbound'), allowNull: false },
  // IMAP / SMTP 식별자 (RFC 822)
  message_id: { type: DataTypes.STRING(500), allowNull: false },
  in_reply_to: { type: DataTypes.STRING(500), allowNull: true },
  references_chain: { type: DataTypes.TEXT, allowNull: true },

  // 분류에 쓰는 헤더만 골라 보관 (List-Unsubscribe · Precedence · Auto-Submitted 등).
  //   원문 헤더 전체를 담지 않는다 — 판정에 안 쓰는 값까지 쌓을 이유가 없다 (키 목록은 emailTriage.TRIAGE_HEADER_KEYS).
  //   이게 없으면 재판정 경로에서 광고·자동발송 판정이 눈을 감아, 제목 패턴으로 우회할 수밖에 없었다.
  //   NULL = 이 컬럼이 생기기 전에 수집된 메일 (그때는 저장된 triage 를 그대로 신뢰한다).
  triage_headers: { type: DataTypes.JSON, allowNull: true },
  imap_uid: { type: DataTypes.INTEGER, allowNull: true },
  // From/To/Cc/Bcc
  from_email: { type: DataTypes.STRING(255), allowNull: true },
  from_name: { type: DataTypes.STRING(100), allowNull: true },
  to_emails: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  cc_emails: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
  bcc_emails: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
  // 본문
  subject: { type: DataTypes.STRING(500), allowNull: true },
  body_html: { type: DataTypes.TEXT('long'), allowNull: true },
  body_text: { type: DataTypes.TEXT('long'), allowNull: true },
  // 발신
  sent_by_user_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  is_read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // 상태
  // 'suppressed' — 서버 발송 게이트(EMAIL_SENDING_ENABLED=false)가 막은 발송.
  //   'sent' 와 반드시 구분한다. 섞으면 dev 에서 "보냈다" 는 거짓 기록이 남는다.
  // 'delivered' 는 DSN 이 있어야 알 수 있어 발송 시점엔 절대 기록하지 않는다.
  delivery_status: {
    type: DataTypes.ENUM('pending', 'sent', 'delivered', 'bounced', 'failed', 'suppressed'),
    allowNull: false, defaultValue: 'sent',
  },
  delivery_error: { type: DataTypes.TEXT, allowNull: true },
  // AI 분석 (백그라운드 채움)
  ai_intent: { type: DataTypes.STRING(50), allowNull: true },
  ai_summary: { type: DataTypes.STRING(500), allowNull: true },
  ai_processed_at: { type: DataTypes.DATE, allowNull: true },
  // 메타
  sent_at: { type: DataTypes.DATE, allowNull: false },
  // M4 FAQ 클러스터링 — inbound 질문 임베딩 캐시 (text-embedding-3-small 1536d BLOB).
  // 메시지당 1회만 임베딩 → cron 재실행 시 재사용 (AI 최소 사용).
  faq_embedding: { type: DataTypes.BLOB('medium'), allowNull: true },
  // 업체 메일함 중 어디서 가져왔는가 (docs/MAIL_SENT_SPAM_SYNC_DESIGN.md). PlanQ 발송분·옛 행은 'inbox'.
  //   «증거원에서 스팸을 뺀다» 의 손잡이다 — isKnownContact ④ 가 `source_folder <> 'spam'` 으로 본다.
  source_folder: { type: DataTypes.ENUM('inbox', 'sent', 'spam'), allowNull: false, defaultValue: 'inbox' },
  // 보낸편지함 메일의 받는 사람(to/cc)이 **전부 우리 주소**다(전달·메모·자기 앞 발송).
  //   «우리가 답했다» 가 아니다 — reply_needed 끄기·상담 outboundCount·FAQ 표준답변은 0 인 것만 센다(Fable 판정 ②).
  internal_only: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  sequelize, tableName: 'email_messages', timestamps: true, underscored: true,
  indexes: [
    { fields: ['thread_id', 'sent_at'], name: 'email_messages_thread_time' },
    { fields: ['business_id', 'direction', 'sent_at'], name: 'email_messages_biz_dir_time' },
    { fields: ['message_id'], name: 'email_messages_message_id' },
  ],
});

module.exports = EmailMessage;
