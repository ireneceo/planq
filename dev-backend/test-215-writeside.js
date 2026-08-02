// #215 Fable — 쓰기측 saveAttachmentAsFile 실행 검증 (검증 후 삭제, 데이터 원복)
//   실코드 실행을 위해 emailImapCron.js 원문 + export 1줄 임시 사본을 services/ 에 만든다.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'services', 'emailImapCron.js');
const TMP = path.join(__dirname, 'services', '__test215_cron_copy.js');
fs.writeFileSync(TMP, fs.readFileSync(SRC, 'utf8') + '\nmodule.exports._test_save = saveAttachmentAsFile;\n');

let PASS = 0, FAIL = 0;
const check = (n, ok, ex) => { if (ok) { PASS++; console.log(`  ✓ ${n}${ex ? ' — ' + ex : ''}`); } else { FAIL++; console.log(`  ✗ FAIL ${n}${ex ? ' — ' + ex : ''}`); } };

(async () => {
  const { sequelize } = require('./config/database');
  const { File } = require('./models');
  const save = require('./services/__test215_cron_copy.js')._test_save;
  const created = [];
  try {
    const content = Buffer.from('fable-215-writeside-test');
    // (a) 개인 계정 → L1 + uploader=계정 주인
    const fid1 = await save({
      businessId: 5, att: { filename: 'fable-215-a.txt', contentType: 'text/plain', content, size: content.length },
      account: { owner_user_id: 999001 }, fallbackOwnerId: 5,
    });
    if (fid1) created.push(fid1);
    const f1 = fid1 && await File.findByPk(fid1);
    check('개인 계정 → vlevel=L1 + visibility=L1', f1 && f1.vlevel === 'L1' && f1.visibility === 'L1', f1 && `${f1.vlevel}/${f1.visibility}`);
    check('개인 계정 → uploader=계정 주인(999001)', f1 && f1.uploader_id === 999001, f1 && 'up=' + f1.uploader_id);

    // (b) 회사 계정(owner_user_id NULL) → L3 + uploader=fallback
    const fid2 = await save({
      businessId: 5, att: { filename: 'fable-215-b.txt', contentType: 'text/plain', content, size: content.length },
      account: { owner_user_id: null }, fallbackOwnerId: 5,
    });
    if (fid2) created.push(fid2);
    const f2 = fid2 && await File.findByPk(fid2);
    check('회사 계정 → vlevel=L3 + visibility=L3', f2 && f2.vlevel === 'L3' && f2.visibility === 'L3', f2 && `${f2.vlevel}/${f2.visibility}`);
    check('회사 계정 → uploader=fallback(5)', f2 && f2.uploader_id === 5, f2 && 'up=' + f2.uploader_id);

    // (c) 노이즈 mime → File 미생성 (null)
    const before = await File.count();
    const fid3 = await save({
      businessId: 5, att: { filename: 'attachment', contentType: 'text/rfc822-headers', content, size: content.length },
      account: { owner_user_id: null }, fallbackOwnerId: 5,
    });
    const after = await File.count();
    check('노이즈(rfc822-headers) → null + File row 미생성', fid3 === null && before === after, `ret=${fid3} count ${before}→${after}`);
    // 파라미터화 mime 도 (charset 붙은 형태)
    const fid4 = await save({
      businessId: 5, att: { filename: 'attachment', contentType: 'text/rfc822-headers; charset=us-ascii', content, size: content.length },
      account: { owner_user_id: null }, fallbackOwnerId: 5,
    });
    check('노이즈 mime 파라미터 변형도 skip', fid4 === null, 'ret=' + fid4);
  } finally {
    // 원복 — 생성 row + 물리 파일 제거
    for (const id of created) {
      const f = await File.findByPk(id);
      if (f) { try { fs.unlinkSync(f.file_path); } catch { /* noop */ } await f.destroy({ force: true }); }
    }
    const remain = await File.count({ where: { id: created } });
    console.log(`\n원복: 생성 ${created.length}건 삭제, 잔존 ${remain}건`);
    fs.unlinkSync(TMP);
    await sequelize.close();
  }
  console.log(`\n════ 쓰기측 결과: PASS ${PASS} / FAIL ${FAIL} ════`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('오류:', e); try { fs.unlinkSync(TMP); } catch { /* noop */ } process.exit(2); });
