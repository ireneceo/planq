const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Message extends Model {}

Message.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  conversation_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'conversations', key: 'id' }
  },
  sender_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  task_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'tasks', key: 'id' }
  },
  invoice_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'invoices', key: 'id' }
  },
  // ─── 메시지 유형 ───
  // text: 일반 / system: 자동 상태 안내 / card: task/invoice/event 인라인 카드
  kind: {
    type: DataTypes.ENUM('text', 'system', 'card'),
    defaultValue: 'text',
    allowNull: false
  },
  // ─── Cue 메타 ───
  is_ai: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  // Cue 답변 평가 (사이클 N+27 Phase 5-4) — Cue 메시지에만 의미
  cue_rating: { type: DataTypes.TINYINT, allowNull: true, comment: '-1=down, 0=neutral, 1=up' },
  cue_rating_at: { type: DataTypes.DATE, allowNull: true },
  cue_rating_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
  ai_confidence: {
    type: DataTypes.DECIMAL(4, 3),
    allowNull: true
  },
  ai_source: {
    type: DataTypes.ENUM('pinned_faq', 'kb_rag', 'session_reuse', 'general'),
    allowNull: true
  },
  ai_sources: {
    type: DataTypes.JSON,
    allowNull: true
  },
  ai_model: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  ai_mode_used: {
    type: DataTypes.ENUM('auto', 'draft'),
    allowNull: true
  },
  // Draft 승인 상태 (draft 만 해당). null=승인 전, true=발송됨, false=거절됨
  ai_draft_approved: {
    type: DataTypes.BOOLEAN,
    allowNull: true
  },
  ai_draft_approved_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  ai_draft_approved_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // ─── 카드 메시지 메타 (kind='card' 일 때 사용) ───
  // { card_type: 'post' | 'task' | 'invoice' | ..., 그 외 카드별 필드 }
  meta: {
    type: DataTypes.JSON,
    allowNull: true
  },
  // ─── 내부 메모 (고객에겐 안 보임) ───
  is_internal: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  // ─── 수정/삭제 ───
  is_edited: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  edited_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // 사이클 N+16-E — 메시지 핀 공지 (Slack 패턴).
  pinned_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  pinned_by_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  // ─── Phase 5 답글 + Cue Draft 잠금 ───
  reply_to_message_id: {
    type: DataTypes.BIGINT,
    allowNull: true
  },
  cue_draft_processing_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  cue_draft_processing_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // 번역 캐시 (Conversation.translation_enabled=true 일 때 발송 시점에 채움)
  // { ko: "안녕", en: "Hello" } 형태. 두 언어 모두 저장.
  translations: {
    type: DataTypes.JSON,
    allowNull: true
  },
  detected_language: {
    type: DataTypes.STRING(10),
    allowNull: true
  }
}, {
  sequelize,
  tableName: 'messages',
  timestamps: true,
  underscored: true,
  hooks: {
    // ── 게스트 답글 알림 (#259 A안) ─────────────────────────────────────────
    // ★ **여기가 유일한 트리거다.** 게스트에게 보이는 메시지를 만드는 곳은 대화 라우트 둘만이
    //   아니다 — Cue 자동응답·청구서 발송·문서/공유/서명 카드까지 여덟 곳이 넘고, 새 기능마다
    //   또 는다. 라우트마다 호출을 심는 방식은 새로 생긴 경로에서 **조용히 빠진다**(이미 겪었다).
    //   "보이게 된 순간" 을 잡으면 경로를 세지 않아도 된다.
    // ★ 훅은 트랜잭션 안이다. 실제 일은 커밋 뒤로 미룬다(services/guest_notify.js).
    afterCreate: (instance, options) => {
      try { require('../services/guest_notify').scheduleGuestNotify(instance, options); } catch { /* 알림 실패가 메시지 저장을 막지 않는다 */ }
    },
    // 초안 승인은 **생성이 아니라 update** 로 보이게 된다 — 그 전이도 답글이다.
    afterUpdate: (instance, options) => {
      try {
        if (!instance.changed || !instance.changed('ai_draft_approved')) return;
        if (instance.ai_draft_approved !== true && instance.ai_draft_approved !== 1) return;
        require('../services/guest_notify').scheduleGuestNotify(instance, options);
      } catch { /* 위와 같다 */ }
    },
  },
});

module.exports = Message;
