// 보관기간 리포트 — 지금 규칙을 적용하면 무엇이 지워지는가. **읽기만 한다.**
//   운영에서 플래그를 켜기 전에 이걸로 숫자를 본다.
require('dotenv').config();
const { runRetentionPurge } = require('../services/retentionPurge');
const { runUploadCleanup } = require('../services/uploadCleanup');

(async () => {
  const audit = await runRetentionPurge({ apply: false });
  console.log('=== 감사 로그 ===');
  console.log(JSON.stringify(audit, null, 1));
  console.log('\n=== 휴지통(파일) — 현재 동작 + 플랜 기준 델타 ===');
  console.log('   * 이 호출은 실제로 지운다(현행 30일 술어). 리포트만 원하면 실행하지 말 것.');
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
