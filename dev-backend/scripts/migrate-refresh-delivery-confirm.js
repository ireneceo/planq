// #244 마이그레이션 — refresh_tokens.first_used_at 추가 (수령 확인 회전). 멱등.
//
// 왜 필요한가
//   운영 실측(#244): 회전은 서버에 커밋됐는데 응답의 `Set-Cookie` 가 브라우저에 착지하지 못하면,
//   브라우저 jar 에는 **이미 revoke 된 옛 쿠키**만 남는다. 그 쿠키는 rotation grace(15분)가
//   지나는 순간 영구 401 이 되어 사용자를 강제 로그아웃시킨다. 실제 사망 3건의 경과가
//   23분 / 44분 / 89분 — 전부 창 밖이었다. Mac Chrome 은 PWA 창과 브라우저 탭이 **쿠키 jar 를
//   공유**하므로, 한 번 독이 되면 PWA + 모든 탭이 연쇄로 죽는다(실측 web 3연타).
//
//   시간 창을 늘리는 것은 대리 지표를 늘리는 것일 뿐이다. 진짜 질문은
//   **"클라이언트가 후속 토큰을 실제로 받았는가"** 이고, 그 답은 "후속 토큰이 한 번이라도
//   사용됐는가" 로 알 수 있다. 이 컬럼이 그 사실을 기록한다.
//
//   ★ last_used_at 은 쓸 수 없다 — createRefreshTokenRow 가 **생성 시점에 NOW 로 채운다**.
//     "만들어졌다" 와 "사용됐다" 를 구분하지 못하므로 별도 컬럼이 필요하다.
//
// 안전성
//   NULL 허용 컬럼 추가뿐. 기존 row 는 전부 NULL = "사용 여부 모름" 으로 시작한다.
//   판정 코드는 그 경우 **옛 동작(시간 grace)** 으로 폴백하므로 배포 직후 회귀가 없다.
//
// ★ 배포 순서: 이 스크립트(DB) → 백엔드. 모델이 컬럼을 선언하므로 역전하면
//   RefreshToken 조회 전체가 ER_BAD_FIELD_ERROR → **로그인·갱신 전멸**이다.
//
// 롤백
//   ALTER TABLE refresh_tokens DROP COLUMN first_used_at;
//   (기록용 컬럼이라 삭제해도 데이터 손실 없음 — 판정이 옛 시간 grace 로 돌아갈 뿐)
require('dotenv').config();
const { sequelize } = require('../config/database');

const TABLE = 'refresh_tokens';
const COLUMN = 'first_used_at';

async function columnType() {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`,
    { replacements: { t: TABLE, c: COLUMN } },
  );
  return rows[0] ? rows[0].t : null;
}

const ENUM_COLUMN = 'revoked_reason';
const NEW_ENUM_VALUE = 'superseded_undelivered';
const ENUM_DDL = "ENUM('rotated','logout','reuse_detected','admin','expired','superseded_undelivered') NULL";

async function enumType() {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`,
    { replacements: { t: TABLE, c: ENUM_COLUMN } },
  );
  return rows[0] ? rows[0].t : null;
}

async function run() {
  let changed = 0;

  // 1. first_used_at — 수령 확인 기록
  if (await columnType()) {
    console.log(`· ${TABLE}.${COLUMN} 이미 존재 — skip`);
  } else {
    console.log(`→ ${TABLE}.${COLUMN} 추가`);
    await sequelize.query(`ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} DATETIME NULL`);
    changed += 1;
  }

  // 2. revoked_reason ENUM 에 superseded_undelivered 추가
  //    (미수령 후속을 폐기할 때 쓰는 사유. ENUM 에 없으면 UPDATE 가 SequelizeDatabaseError 로 죽는다)
  const cur = await enumType();
  if (cur && cur.includes(NEW_ENUM_VALUE)) {
    console.log(`· ${TABLE}.${ENUM_COLUMN} 에 ${NEW_ENUM_VALUE} 이미 있음 — skip`);
  } else if (!cur) {
    console.error(`✗ ${TABLE}.${ENUM_COLUMN} 컬럼이 없습니다`);
    process.exitCode = 1;
    return;
  } else {
    console.log(`→ ${TABLE}.${ENUM_COLUMN} 에 ${NEW_ENUM_VALUE} 추가`);
    // ENUM 값 **추가**는 기존 값을 건드리지 않는다 (끝에 붙이므로 기존 row 무영향)
    await sequelize.query(`ALTER TABLE ${TABLE} MODIFY ${ENUM_COLUMN} ${ENUM_DDL}`);
    changed += 1;
  }

  // 검증 — ALTER 성공 로그가 아니라 스키마를 다시 읽어 판정한다
  const t = await columnType();
  const e = await enumType();
  const ok = !!t && !!e && e.includes(NEW_ENUM_VALUE);
  console.log(`${t ? '✓' : '✗'} ${TABLE}.${COLUMN} = ${t || '(없음)'}`);
  console.log(`${e && e.includes(NEW_ENUM_VALUE) ? '✓' : '✗'} ${TABLE}.${ENUM_COLUMN} = ${e || '(없음)'}`);
  console.log(ok ? `완료 (변경 ${changed}건)` : '실패 — 위 ✗ 항목 확인');
  if (!ok) process.exitCode = 1;
}

run()
  .catch((e) => { console.error('마이그레이션 실패:', e.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
