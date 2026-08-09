// #252 마이그레이션 — posts.created_at / updated_at 을 DATETIME → DATETIME(3). 멱등.
//
//   왜: updated_at 이 #252 자동저장의 **낙관적 잠금 기준 컬럼**이다. 기본 DATETIME 은 초 정밀도라
//       같은 초 안에 일어난 두 저장이 `base == cur` 로 잠금을 통과한다 → 남이 방금 쓴 본문을
//       조용히 덮는다. 자동저장이 붙어 PUT 빈도가 수십 배로 뛴 뒤엔 실화가 된다.
//       editor_id 로 "마지막 기록자가 남이면 충돌" 로 구분하려던 시도는 **틀렸다** —
//       남이 오래 전에 편집한 문서를 처음 여는 정상 케이스와 상태가 완전히 동일해
//       모든 타인 문서 편집이 거짓 409 가 된다. 정밀도 자체를 올려야 풀린다.
//
//   안전성: DATETIME → DATETIME(3) 은 **정밀도 확대**다. 기존 값은 .000 으로 패딩될 뿐
//       잘리는 데이터가 없다(축소 방향인 (3)→(0) 만 반올림 손실이 있다).
//       posts 는 소규모 테이블이고 ALGORITHM=INPLACE 대상이지만, MySQL 8 은 datetime 정밀도
//       변경을 COPY 로 처리할 수 있어 이 스크립트는 알고리즘을 지정하지 않는다(서버 선택에 위임).
//
//   ★ 배포 순서: 이 스크립트(DB) → 백엔드 → 프론트.
//     역전해도 파손은 없다(옛 백엔드는 ms 를 안 쓰고 새 백엔드는 (0) 에서도 동작한다 — 다만
//     잠금 구멍이 그대로 남는다). 순서를 지키면 구멍이 열려 있는 창 자체가 없다.
//
//   롤백: ALTER TABLE posts MODIFY created_at DATETIME NOT NULL, MODIFY updated_at DATETIME NOT NULL;
//     (밀리초가 반올림되어 사라지지만 애플리케이션 동작에는 영향 없음 — 잠금 구멍만 복귀)
require('dotenv').config();
const { sequelize } = require('../config/database');

const TARGET = 'datetime(3)';
const COLUMNS = ['created_at', 'updated_at'];

async function currentType(col) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_TYPE AS t, IS_NULLABLE AS n
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'posts' AND COLUMN_NAME = :col`,
    { replacements: { col } }
  );
  return rows[0] || null;
}

async function run() {
  let changed = 0;
  for (const col of COLUMNS) {
    const cur = await currentType(col);
    if (!cur) {
      console.error(`✗ posts.${col} 컬럼이 없습니다 — 스키마 확인 필요`);
      process.exitCode = 1;
      return;
    }
    if (String(cur.t).toLowerCase() === TARGET) {
      console.log(`· posts.${col} 이미 ${TARGET} — skip`);
      continue;
    }
    console.log(`→ posts.${col} ${cur.t} → ${TARGET} ALTER 실행`);
    // NOT NULL 유지 (Sequelize timestamps 는 항상 값을 쓴다)
    await sequelize.query(`ALTER TABLE posts MODIFY ${col} DATETIME(3) NOT NULL`);
    changed += 1;
  }

  // 검증 — 실제 컬럼 타입을 다시 읽어 확인한다 (ALTER 성공 로그만으로 판정하지 않는다)
  let ok = true;
  for (const col of COLUMNS) {
    const cur = await currentType(col);
    const good = String(cur?.t).toLowerCase() === TARGET;
    console.log(`${good ? '✓' : '✗'} posts.${col} = ${cur?.t}`);
    if (!good) ok = false;
  }
  console.log(ok ? `완료 (변경 ${changed}건)` : '실패 — 컬럼 타입이 목표와 다릅니다');
  if (!ok) process.exitCode = 1;
}

run()
  .catch((e) => { console.error('마이그레이션 실패:', e.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
