// canary-folder-dnd — 파일을 **폴더로 끌어다 놓을 수 있는가** (2026-09-07)
//
//   Irene: "우리 솔루션에서 폴더에 드래그드롭하게 해주고"
//
//   서버의 이동 API(POST /api/files/:biz/:id/move)는 진작 있었는데 화면에 드롭 존이 없었다.
//   여기서는 **화면이 실제로 받는가**를 잰다 — 계약 3가지:
//     ① 파일 행이 draggable 이다 (아니면 끌 수가 없다)
//     ② 폴더 행이 우리 전용 MIME 에만 반응한다 (text/plain 으로 받으면 아무 텍스트나 이동이 된다)
//     ③ 실제로 드롭하면 서버에 반영된다 (화면만 바뀌면 새로고침에 되돌아온다)
//
//   ★ 양성/음성 대조군 — 시드 파일을 폴더에 넣었다가 확인하고 원래대로 되돌린다.
const b = require('./lib/browser');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const BIZ = 5;
const ME = 5;   // health-check — 이 워크스페이스 owner (= 업로더여야 이동 권한이 있다)

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let fileId = null, folderId = null;
  const { browser, page } = await b.launch();
  try {
    // 시드 — 폴더 하나 + 그 폴더 **밖에** 있는 파일 하나
    const [fid] = await sequelize.query(
      `INSERT INTO file_folders (business_id, project_id, parent_id, name, sort_order, created_by, created_at, updated_at)
       VALUES (?, NULL, NULL, 'DnD 카나리 폴더', 999, ?, NOW(), NOW())`,
      { replacements: [BIZ, ME] });
    folderId = fid;
    const [fileRow] = await sequelize.query(
      `INSERT INTO files (business_id, project_id, folder_id, uploader_id, file_name, file_path,
                          file_size, mime_type, storage_provider, visibility, vlevel, security_level,
                          ref_count, created_at, updated_at)
       VALUES (?, NULL, NULL, ?, 'dnd-canary.txt', '/tmp/dnd-canary-nonexistent.txt',
               11, 'text/plain', 'planq', 'L3', 'L3', 'general', 1, NOW(), NOW())`,
      { replacements: [BIZ, ME] });
    fileId = fileRow;

    await b.login(page);
    await b.goto(page, '/files');
    await b.sleep(4000);

    // ① 파일 행이 끌 수 있는가
    const dragable = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('*')).filter(
        el => (el.textContent || '').includes('dnd-canary.txt') && el.getAttribute('draggable') === 'true');
      return rows.length;
    });
    push('파일 행이 draggable 이다', dragable > 0,
      `draggable 행 ${dragable}개 — 0 이면 끌 수조차 없다`);

    // ② 폴더 행이 우리 전용 MIME 에만 반응하는가
    const accept = await page.evaluate(() => {
      const MIME = 'application/x-planq-file';
      const target = Array.from(document.querySelectorAll('div'))
        .find(el => (el.textContent || '').trim().startsWith('DnD 카나리 폴더') && el.children.length > 0
          && el.querySelectorAll('div').length < 6);
      if (!target) return { found: false };
      const fire = (type, mime) => {
        const dt = new DataTransfer();
        if (mime) dt.setData(mime, 'direct-1');
        const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
        target.dispatchEvent(ev);
        return ev.defaultPrevented;   // preventDefault = "여기 놓을 수 있다"
      };
      return { found: true, ours: fire('dragover', MIME) };
    });
    push('폴더 행이 드롭을 받는다', accept.found && accept.ours === true,
      accept.found ? `전용 MIME preventDefault=${accept.ours}` : '폴더 행을 화면에서 못 찾았다');

    // 아무 텍스트나 받지는 않는가 — **preventDefault 로 재면 안 된다.**
    //   폴더 트리 위에 업로드 드롭존이 있어 dragover 를 조상이 preventDefault 한다(실측).
    //   판정은 결과로 한다: text/plain 을 떨어뜨려도 파일이 움직이면 안 된다.
    const beforePlain = await sequelize.query('SELECT folder_id FROM files WHERE id = ?',
      { replacements: [fileId], type: sequelize.QueryTypes.SELECT });
    await page.evaluate(() => {
      const target = Array.from(document.querySelectorAll('div'))
        .find(el => (el.textContent || '').trim().startsWith('DnD 카나리 폴더') && el.children.length > 0
          && el.querySelectorAll('div').length < 6);
      if (!target) return;
      const dt = new DataTransfer();
      dt.setData('text/plain', 'direct-1');
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await b.sleep(1500);
    const afterPlain = await sequelize.query('SELECT folder_id FROM files WHERE id = ?',
      { replacements: [fileId], type: sequelize.QueryTypes.SELECT });
    push('아무 텍스트나 받지는 않는다',
      String(beforePlain[0] && beforePlain[0].folder_id) === String(afterPlain[0] && afterPlain[0].folder_id),
      `folder_id ${beforePlain[0] && beforePlain[0].folder_id} → ${afterPlain[0] && afterPlain[0].folder_id} (안 바뀌어야 한다)`);

    // ③ 실제로 떨어뜨리면 서버에 남는가
    const before = await sequelize.query('SELECT folder_id FROM files WHERE id = ?',
      { replacements: [fileId], type: sequelize.QueryTypes.SELECT });
    const dropped = await page.evaluate((fid) => {
      const MIME = 'application/x-planq-file';
      const target = Array.from(document.querySelectorAll('div'))
        .find(el => (el.textContent || '').trim().startsWith('DnD 카나리 폴더') && el.children.length > 0
          && el.querySelectorAll('div').length < 6);
      if (!target) return false;
      const dt = new DataTransfer();
      dt.setData(MIME, `direct-${fid}`);
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    }, fileId);
    await b.sleep(2500);
    const after = await sequelize.query('SELECT folder_id FROM files WHERE id = ?',
      { replacements: [fileId], type: sequelize.QueryTypes.SELECT });
    push('떨어뜨리면 서버에 반영된다',
      dropped && Number(after[0] && after[0].folder_id) === Number(folderId),
      `folder_id ${before[0] && before[0].folder_id} → ${after[0] && after[0].folder_id} (기대 ${folderId}) — 화면만 바뀌면 새로고침에 되돌아온다`);
  } catch (e) {
    push('카나리 실행', false, String(e && e.message || e));
  } finally {
    try { if (fileId) await sequelize.query('DELETE FROM files WHERE id = ?', { replacements: [fileId] }); } catch { /* noop */ }
    try { if (folderId) await sequelize.query('DELETE FROM file_folders WHERE id = ?', { replacements: [folderId] }); } catch { /* noop */ }
    try { await browser.close(); } catch { /* noop */ }
  }
  return results;
}

module.exports = { run };
