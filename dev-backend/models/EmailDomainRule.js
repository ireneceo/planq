// 워크스페이스가 소유한 메일 도메인 — "우리에게 온 메일" 판정의 규칙 축.
//
// 주소를 하나씩 등록하던 방식(email_account_aliases)은 도메인이 늘 때마다 로컬파트 수만큼
// 등록해야 했다. 도메인을 등록하면 그 도메인의 **모든 로컬파트**(help@·irene@·앞으로 만들
// sales@)가 자동으로 우리 주소가 된다 — 도메인 추가 1회, 주소 추가 0회.
//
// ★ "help@ 로 시작하면 도메인 무관" 방식은 의도적으로 채택하지 않았다. 콜드메일이
//   `To: help@남의회사.com` 으로 뿌리며 우리를 숨은참조에 넣으면 그게 전부 "우리에게 온 메일"이
//   된다. 우리가 소유하지 않은 도메인을 여는 것은 편의가 아니라 구멍이다.
//
// ★ 이 테이블은 **수신 인식(triage)** 축 전용이다. 발신(From)은 email_account_aliases 가
//   담당한다 — 메일 제공자가 주소 단위로만 발신을 인증해 주고, 표시 이름·서명도 주소별이라
//   규칙으로 대체할 수 없다. 두 축을 한 테이블에 섞으면 resolveSender 가 도메인 행을 주소로
//   오독할 경로가 생긴다.
//
// ★ Phase 2(도메인 인증 발송)의 앵커 테이블 — verify 상태·DKIM selector 컬럼은 그 설계
//   게이트에서 추가한다. 선반영 금지.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class EmailDomainRule extends Model {}

EmailDomainRule.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  // '@' 없이 소문자 도메인만 저장한다 (라우트에서 정규화·검증).
  domain: { type: DataTypes.STRING(255), allowNull: false },
  note: { type: DataTypes.STRING(200), allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  modelName: 'EmailDomainRule',
  tableName: 'email_domain_rules',
  timestamps: true,
  underscored: true,
  indexes: [
    // 컬럼 레벨 unique: true 를 쓰면 sync 때마다 인덱스가 쌓여 언젠가 "Too many keys" 로 배포가 죽는다
    { unique: true, fields: ['business_id', 'domain'], name: 'email_domain_rules_biz_domain' },
    { fields: ['business_id'], name: 'email_domain_rules_biz' },
  ],
});

module.exports = EmailDomainRule;
