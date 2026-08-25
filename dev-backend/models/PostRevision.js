const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 포스트(글·표) 변경 이력 — 2026-08-25.
//
// 왜 필요한가: 문서를 "항상 저장"(저장 버튼 없음)으로 바꾸려면 되돌릴 수 있어야 한다.
//   Notion·Google Docs 가 저장 버튼 없이도 안심되는 이유가 버전 기록이다. 그것 없이 버튼만
//   없애면 "실수로 지운 문단을 되돌릴 수 없는" 다른 사고를 만든다.
//
// 설계 판단 3가지:
//   ① diff 가 아니라 **스냅샷**. diff 는 용량은 아끼지만 복원 시 체인을 되감아야 하고
//      중간 하나가 깨지면 그 뒤가 전부 죽는다. 수십 KB 문서에서는 스냅샷이 옳다.
//   ② **합치기(coalescing)** 가 핵심. 자동저장은 2초마다 나가므로 그대로 쌓으면 한 시간에
//      수백 행이 된다. 같은 사람이 COALESCE_WINDOW 안에 이어 쓰면 마지막 행을 갱신하고,
//      사람이 바뀌거나 시간이 지나면 새 행을 만든다 → 이력이 "사람 단위"로 읽힌다.
//   ③ 복원은 **파괴적이지 않다**. 옛 버전으로 되돌리면 새 행이 하나 더 쌓인다(source='restore').
//      되돌린 것을 다시 되돌릴 수 있어야 한다.
//
// 용량: 문서 20KB × 50버전 = 1MB. 문서당 MAX_PER_POST 로 자르고 넣을 때 정리한다(cron 불필요).
// 한계(화면에 명시할 것): **첨부는 버전 대상이 아니다.** 본문·제목·분류만 스냅샷한다.
class PostRevision extends Model {}

PostRevision.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  post_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'posts', key: 'id' } },
  // ★ 멀티테넌트 격리 — 모든 조회가 이 컬럼을 WHERE 에 넣는다 (CLAUDE.md 필수 규칙).
  //   post 를 조인해서 판정할 수도 있지만, 격리 축을 조인에 의존하면 한 곳만 빠져도 샌다.
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  revision_number: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING(200), allowNull: true },
  content_json: { type: DataTypes.TEXT('long'), allowNull: true },   // posts.content_json 과 같은 형식(문자열)
  category: { type: DataTypes.STRING(100), allowNull: true },
  editor_user_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  // autosave: 타이핑 중 저장 / manual: 명시 저장 / restore: 옛 버전 복원으로 생긴 것
  source: { type: DataTypes.ENUM('autosave', 'manual', 'restore'), allowNull: false, defaultValue: 'autosave' },
  byte_size: { type: DataTypes.INTEGER, allowNull: true },           // 용량 감시용 (운영 집계)
  // 문서 하단 첨부 목록의 file_id 배열. 본문 안 이미지는 content_json 에 이미 들어 있지만,
  //   첨부 목록은 별도 테이블(post_attachments)이라 여기 함께 남기지 않으면 복원해도 안 돌아온다.
  attachment_file_ids: { type: DataTypes.JSON, allowNull: true },
}, {
  sequelize,
  tableName: 'post_revisions',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['post_id', 'revision_number'] },
    { fields: ['business_id'] },
    { fields: ['post_id', 'created_at'] },
  ],
});

module.exports = PostRevision;
