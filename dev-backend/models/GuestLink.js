// 무로그인 게스트 링크 (운영 #259) — docs/GUEST_LINK_DESIGN.md
//
// Irene: "카톡 채팅으로 일하는 고객이 하나도 불편하지 않게 우리 채팅에서 요청을 하게 할 방법을
//   찾는 거야. 우리 업무정보가 워크스페이스에 모여야 하는데 고객사를 불편하게 하면
//   거기서 영업이 나쁘게 작동하기 때문이야."
//
// ★ 위협 모델을 정직하게 적는다 — **링크를 아는 사람이 그 고객이라는 보장은 없다.**
//   카톡방의 제3자도 같은 링크로 읽고 쓴다. 이건 막을 수 없다.
//   그래서 이 설계는 유출을 막는 것이 아니라 **유출됐을 때 열리는 것의 상한**을 구조로 고정한다:
//     · 대화방 **하나** (다른 대화방·워크스페이스는 파라미터 자체가 없어 닿지 않는다)
//     · 그 방의 **고객 노출 메시지만** (내부 메모는 애초에 실리지 않는다)
//     · **텍스트 작성만** (파일 업로드는 2단계)
//     · 파일 다운로드는 **로그인 잠금**
//
// ★ 만료는 **마지막 사용 후 90일 슬라이딩**이다(2026-09-02 Fable 판정으로 고정 30일에서 개정).
//   고정 만료는 두 달 전 카톡 링크를 누른 고객에게 "만료" 를 보여준다 — 그것이 곧 영업 손상이다.
//   쓰는 고객은 안 끊기고 떠난 고객의 링크는 죽는다. 죽어도 다음 알림 메일에 새 토큰이 실린다.
//
// ★ 원문 토큰은 **저장하지 않는다.** sha256 만 저장하고 원문은 발급 응답에 1회만 나간다.
//   DB 가 새어도 링크가 새지 않는다. 관리 화면 식별은 앞 6자(token_hint)로 한다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class GuestLink extends Model {}

GuestLink.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  // 열람·작성 범위 = 이 대화방 하나. 이 컬럼이 곧 피해 상한이다.
  conversation_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'conversations', key: 'id' } },
  // ★ 이 링크가 여는 것의 **종류**. 파생 열쇠를 막는 축이다 (docs/PROJECT_EXTERNAL_VIEW_DESIGN §2.2).
  //   'conversation' — 대화방 하나(지금까지의 채팅 링크). 프로젝트 탭 라우트는 **404**.
  //   'project'      — 프로젝트 페이지(개요·업무·대화). 대화 탭은 같은 방을 그대로 쓴다.
  //   기본값이 'conversation' 인 이유: **이미 나가 있는 링크가 조용히 넓어지면 안 된다.**
  //   기존 행은 전부 conversation 으로 남고, 프로젝트 링크는 새로 발급해야만 생긴다.
  scope: {
    type: DataTypes.ENUM('conversation', 'project'),
    allowNull: false,
    defaultValue: 'conversation',
  },
  // NULL 이면 프로젝트 개요 탭이 없다. 있으면 **화이트리스트 serializer** 로만 내보낸다.
  //   ★ projects.id 만 BIGINT 다(다른 테이블은 INT). 타입을 맞추지 않으면 FK 생성이
  //     "incompatible" 로 실패하고 **테이블 자체가 안 만들어진다**(실측).
  project_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'projects', key: 'id' } },
  // 게스트의 명함 = 기존 Client row. 신원(그림자 User)은 여기가 아니라 **Client 에** 있다.
  // 고객은 **선택**이다 (2026-09-02). 링크는 사람이 아니라 **방**에 붙는다 —
  //   한 링크를 카톡방에서 여럿이 나눠 가지는 것이 이 기능의 전제(설계 §2)라
  //   Client(=명함)를 필수 부모로 두는 것 자체가 모델 오류였다.
  //   대화방에 고객이 붙어 있으면 발급 시 자동 복사(타임라인 연속성), 없으면 NULL.
  client_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'clients', key: 'id' } },
  // 그림자 User — 링크당 1개. 신원(누가 썼나)의 원천.
  //   화면에 뜨는 이름은 여기가 아니라 messages.meta.guest.name 이다.
  guest_user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  token_hash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
  token_hint: { type: DataTypes.CHAR(6), allowNull: false, comment: '원문 앞 6자 — 관리 UI 식별용(복원 불가)' },
  // 멤버가 붙이는 메모용 이름(선택). **화면 표시명이 아니다.**
  guest_name: { type: DataTypes.STRING(100), allowNull: true },
  can_write: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, comment: 'false = 열람 전용' },
  // 슬라이딩 — 쓸 때마다 뒤로 밀린다 (services/guest_link.js resolve 가 갱신).
  expires_at: { type: DataTypes.DATE, allowNull: false },
  message_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, comment: '남용 가시화' },
  last_used_at: { type: DataTypes.DATE, allowNull: true },
  last_used_ip: { type: DataTypes.STRING(45), allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  // 게스트가 "계정 요청하기" 를 누른 시각·적어 보낸 이메일 (#259, 2026-09-02).
  //   ★ 게스트 화면에 가입 버튼을 붙이지 않는 이유: 초대 토큰 없이 가입하면
  //     `routes/auth.js:216` 가 **자기 워크스페이스를 새로 만든다.** 고객은 빈 화면에 떨어지고
  //     이 대화는 못 본다. 계정 생성 진입은 **멤버가 보내는 초대 메일** 한 곳뿐이다.
  //   여기 기록은 "멤버에게 요청이 갔다" 는 사실과 중복 요청 가드(24h)용이다.
  account_requested_at: { type: DataTypes.DATE, allowNull: true },
  requested_email: { type: DataTypes.STRING(200), allowNull: true },
  revoked_at: { type: DataTypes.DATE, allowNull: true },
  revoked_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },

  // ─── 개인 링크 (#259 A안, 2026-09-03) ────────────────────────────────────
  //
  // Irene: "A로 하면 고객에게 이름이랑 이메일 등록하게 해야 하네. 그렇게 게스트가 되면
  //   나중에 Q sale 메뉴에도 등록되면 되겠네."
  //
  // ★ 형태를 정한 것은 **원문 토큰을 저장하지 않는다**는 위 원칙이다(sha256 만 있다).
  //   알림 메일에 열리는 링크를 실으려면 사람마다 자기 토큰이 있어야 한다. 그래서
  //   "사람 = 자기 링크" 가 된다. (회전은 하지 않는다 — 회전시키면 지난 메일의 링크가
  //   전부 죽어 사용자에게는 "만료" 로 보인다. 대신 개별 회수·삭제 수단을 둔다.)
  //     shared   — 카톡방에 퍼지는 링크. 익명·여럿. 지금 그대로.
  //     personal — 이메일을 OTP 로 확인한 사람마다 1개. 부모(shared) 아래 자식.
  //   새 테이블을 만들지 않는 이유: 같은 것을 자식 행으로 표현할 수 있으면 두 번째
  //   저장소는 해석기·박제 id·FK 를 두 벌로 만들 뿐이다.
  kind: {
    type: DataTypes.ENUM('shared', 'personal'), allowNull: false, defaultValue: 'shared',
  },
  parent_link_id: {
    type: DataTypes.INTEGER, allowNull: true, references: { model: 'guest_links', key: 'id' },
    comment: 'personal 링크의 부모(shared). 부모가 닫히면 자식도 닫힌다',
  },
  // ★ contact_name 은 **메시지 표시명의 원천이 아니다.** 표시명은 messages.meta.guest.name 박제다.
  //   여기 이름을 렌더에 쓰면 나중에 이름을 바꿀 때 과거 메시지가 소급해서 바뀐다.
  //   이 값은 멤버 화면·Q sale 프리필 전용.
  contact_name: { type: DataTypes.STRING(30), allowNull: true },
  contact_email: { type: DataTypes.STRING(200), allowNull: true, comment: '소문자 정규화' },
  email_verified_at: { type: DataTypes.DATE, allowNull: true },

  // OTP — 무인증 사용자가 **남의 주소**를 적을 수 있다. 확인 전에는 어떤 알림도 안 나간다.
  otp_hash: { type: DataTypes.CHAR(64), allowNull: true },
  otp_sent_at: { type: DataTypes.DATE, allowNull: true },
  otp_expires_at: { type: DataTypes.DATE, allowNull: true },
  otp_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  otp_locked_until: { type: DataTypes.DATE, allowNull: true },

  // 동의 — 회원가입이 명시 체크를 받으므로(routes/auth.js) 게스트만 예외를 두지 않는다.
  //   방침 버전을 같이 남겨야 나중에 무엇에 동의했는지 소명된다.
  consent_at: { type: DataTypes.DATE, allowNull: true },
  consent_privacy_version: { type: DataTypes.STRING(20), allowNull: true },

  locale: { type: DataTypes.STRING(5), allowNull: true, comment: '알림 메일 언어' },
  // 수신거부 ≠ 링크 회수. 알림만 끄고 대화는 계속 쓴다.
  unsubscribed_at: { type: DataTypes.DATE, allowNull: true },
  last_notified_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  modelName: 'GuestLink',
  tableName: 'guest_links',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id'] },
    { fields: ['conversation_id'] },
    { fields: ['client_id'] },
    { fields: ['expires_at'] },
    // 개인 링크 조회(부모별) + 같은 부모에 같은 주소 중복 방지.
    //   shared 행은 둘 다 NULL 이라 이 유니크에 걸리지 않는다(MySQL 은 NULL 을 중복으로 안 본다).
    { fields: ['parent_link_id'] },
    { unique: true, fields: ['parent_link_id', 'contact_email'], name: 'guest_links_parent_email' },
  ],
});

module.exports = GuestLink;
