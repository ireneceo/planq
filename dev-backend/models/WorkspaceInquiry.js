// 워크스페이스 공개 페이지·창구로 들어온 **문의 건** (2026-11-20 · docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §5.3)
//
// ★ 왜 새 표인가(설계 §5.3 — 09-24 «새 표 금지» 를 이 한 건만 뒤집었다):
//   무인증·미확인 입력을 대화방·메시지·그림자 User·guest_links 에 넣으면 스팸이 Q Talk 와 핵심 표를 더럽히고
//   «보류» 를 둘 자리가 없다. 미확인 연락처 24시간 삭제 규칙과도 충돌한다. 고객 행을 바로 만들면 스팸·오타가
//   고객 목록과 문의 고객 한도를 채운다(Irene 결정 ③ 가 — 신규 문의함에 쌓고 한 번 눌러 고객 등록).
// ★ 모든 조회·변경은 `business_id` + 접근 검사. 쓰는 문은 services/workspaceInquiry.js 한 곳(접수)과
//   routes/workspace_inquiries.js(팀 처리)뿐이다.
// ★ IP 원문은 저장하지 않는다 — 하루 비밀 해시(ip_hash)만(한도·같은 내용 판정용).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class WorkspaceInquiry extends Model {}

WorkspaceInquiry.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  // new = 답할 차례 · handled = 처리함 · held = 보류(기계가 의심 — 알림 없음) · spam = 사람이 스팸으로
  status: { type: DataTypes.ENUM('new', 'handled', 'held', 'spam'), allowNull: false, defaultValue: 'new' },
  // 어느 문으로 왔나 — 공개 주소(P3) / 건네받은 창구 링크
  via: { type: DataTypes.ENUM('public_page', 'entry_link'), allowNull: false },
  name: { type: DataTypes.STRING(100), allowNull: false },
  email: { type: DataTypes.STRING(200), allowNull: false },
  phone: { type: DataTypes.STRING(40), allowNull: true },
  company: { type: DataTypes.STRING(200), allowNull: true },
  message: { type: DataTypes.TEXT, allowNull: false },
  service_id: { type: DataTypes.STRING(24), allowNull: true },
  // 접수 시점 서비스 이름 사본 — 나중에 카드 이름이 바뀌거나 지워져도 «무엇에 대한 문의였나» 가 남는다
  service_name: { type: DataTypes.STRING(80), allowNull: true },
  locale: { type: DataTypes.STRING(5), allowNull: true },
  ip_hash: { type: DataTypes.STRING(64), allowNull: true },
  // 같은 내용 판정용 — 본문 정규화 해시(다른 워크스페이스에 같은 글을 뿌리는 것)
  message_hash: { type: DataTypes.STRING(64), allowNull: true },
  held_reason: { type: DataTypes.STRING(40), allowNull: true },
  client_id: { type: DataTypes.INTEGER, allowNull: true },
  email_thread_id: { type: DataTypes.INTEGER, allowNull: true },
  handled_by: { type: DataTypes.INTEGER, allowNull: true },
  handled_at: { type: DataTypes.DATE, allowNull: true },
  ack_sent_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  modelName: 'WorkspaceInquiry',
  tableName: 'workspace_inquiries',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'status', 'created_at'], name: 'ws_inq_biz_status' },
    { fields: ['email', 'created_at'], name: 'ws_inq_email' },
    { fields: ['message_hash', 'created_at'], name: 'ws_inq_msg' },
  ],
});

module.exports = WorkspaceInquiry;
