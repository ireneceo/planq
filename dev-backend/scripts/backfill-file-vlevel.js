// files.vlevel 백필 — 업로드 시 vlevel 미기록으로 개인/팀 파일이 전 멤버에게 노출되던 결함 정정
//
// 배경: `routes/files.js` 업로드가 legacy `visibility` 만 기록하고 권위 컬럼 `vlevel` 을 쓰지 않아
//       모델 default 'L3'(워크스페이스 전체) 로 저장됐다. 목록 필터(`fileListWhereByLevel`)는
//       vlevel 을 우선하므로, 사용자가 개인(L1)/팀(L2)로 올린 파일이 전 멤버 목록에 노출됐다.
//       (같은 파일이 "개인 보관함"과 "전체 목록"에 동시에 뜨는 모순 상태)
//
// 정정 규칙: visibility 와 vlevel 이 불일치하면 **visibility 를 권위로** vlevel 을 맞춘다.
//   - 업로드 시점에 사용자 의도가 담긴 쪽은 visibility (vlevel 은 손대지 않아 default 가 들어감)
//   - visibility 변경 UI(PUT /:id/visibility)는 두 컬럼을 함께 갱신하므로 그 경로 데이터는 이미 일치
//
// ⚠️ 이 백필은 노출 범위를 **좁힌다** (L3 → L1/L2). 그동안 보이던 파일이 안 보이게 되는 것이
//    정상 동작 복원이다. 실행 전 반드시 dry-run 으로 건수·샘플을 확인할 것.
//
// 실행:
//   node scripts/backfill-file-vlevel.js            # dry-run (기본) — 아무것도 바꾸지 않음
//   node scripts/backfill-file-vlevel.js --apply    # 실제 적용
//
// 멱등: 재실행하면 불일치 0 건으로 "변경 없음" 을 보고한다.

require('dotenv').config();
const { sequelize } = require('../config/database');

const APPLY = process.argv.includes('--apply');

(async () => {
  try {
    await sequelize.authenticate();
    console.log(`DB: ${process.env.DB_NAME}  모드: ${APPLY ? '적용(--apply)' : 'dry-run'}\n`);

    const [dist] = await sequelize.query(
      `SELECT visibility, vlevel, COUNT(*) AS c
         FROM files WHERE deleted_at IS NULL
        GROUP BY visibility, vlevel ORDER BY c DESC`
    );
    console.log('현재 분포 (visibility × vlevel):');
    console.table(dist);

    const [mismatch] = await sequelize.query(
      `SELECT visibility, vlevel, COUNT(*) AS c
         FROM files
        WHERE deleted_at IS NULL
          AND visibility IS NOT NULL AND vlevel IS NOT NULL
          AND visibility <> vlevel
        GROUP BY visibility, vlevel ORDER BY c DESC`
    );
    const total = mismatch.reduce((s, r) => s + Number(r.c), 0);
    if (total === 0) {
      console.log('\n✅ 불일치 0 건 — 백필할 것이 없습니다.');
      process.exit(0);
    }
    console.log(`\n⚠️ 불일치 ${total} 건:`);
    console.table(mismatch);

    const [sample] = await sequelize.query(
      `SELECT id, business_id, uploader_id, file_name, visibility, vlevel, project_id
         FROM files
        WHERE deleted_at IS NULL
          AND visibility IS NOT NULL AND vlevel IS NOT NULL
          AND visibility <> vlevel
        ORDER BY id DESC LIMIT 10`
    );
    console.log('\n샘플 10건:');
    console.table(sample);

    if (!APPLY) {
      console.log('\ndry-run 이라 변경하지 않았습니다. 적용하려면 --apply 를 붙여 다시 실행하세요.');
      process.exit(0);
    }

    const [result] = await sequelize.query(
      `UPDATE files SET vlevel = visibility
        WHERE deleted_at IS NULL
          AND visibility IS NOT NULL AND vlevel IS NOT NULL
          AND visibility <> vlevel`
    );
    console.log(`\n✅ 적용 완료 — ${result.affectedRows ?? total} 건 vlevel 정정`);

    const [after] = await sequelize.query(
      `SELECT COUNT(*) AS c FROM files
        WHERE deleted_at IS NULL
          AND visibility IS NOT NULL AND vlevel IS NOT NULL
          AND visibility <> vlevel`
    );
    console.log(`재검사 잔여 불일치: ${after[0].c} 건`);
    process.exit(0);
  } catch (err) {
    console.error('실패:', err.message);
    console.error(err);
    process.exit(1);
  }
})();
