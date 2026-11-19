// refresh_tokens (user_id, last_used_at) 묶음 색인 (2026-11-19, 멱등).
//   왜: services/lastActive 의 «사람별 마지막 세션 갱신» = MAX(last_used_at) GROUP BY user_id 가
//   user_id 색인만으로는 그 사람의 **모든** 토큰 행을 읽는다. 토큰은 15분마다 새 행이 생기고 지우지 않으므로
//   행이 쌓일수록 느려진다(개발 실측 18만 행 · 멤버 8명 워크스페이스 0.4~0.5초). 그 조회는
//   GET /businesses/:id/members 가 매번 부르고, 워크스페이스 전환 뒤 첫 화면이 그 목록을 여러 번 불러
//   «전환이 갑자기 느려짐»(Irene 2026-11-19)이 됐다. 묶음 색인이면 사람마다 색인 끝 한 칸만 읽는다.
//   ★ 색인 추가만 — 데이터 불변. MySQL 8 은 잠금 없이(INPLACE, LOCK=NONE) 만든다.
//   롤백: DROP INDEX refresh_tokens_user_last_used ON refresh_tokens (코드는 색인 없이도 같은 결과).
const { sequelize } = require('../config/database');

const NAME = 'refresh_tokens_user_last_used';

async function run() {
  const [rows] = await sequelize.query(`SHOW INDEX FROM refresh_tokens WHERE Key_name = '${NAME}'`);
  if (rows.length) {
    console.log(`[refresh-last-used-index] 이미 있음 — skip`);
    return;
  }
  await sequelize.query(`ALTER TABLE refresh_tokens ADD INDEX ${NAME} (user_id, last_used_at), ALGORITHM=INPLACE, LOCK=NONE`);
  console.log(`[refresh-last-used-index] ${NAME} (user_id, last_used_at) 추가`);
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error('[refresh-last-used-index] 실패:', e); process.exit(1); });
