// 운영 #444 백필 — 업무 추가 창으로 올린 «의뢰 명세 첨부» 를 업무 소유로 다시 저장한다. 멱등. 2026-10-02.
//
// 무엇이 깨져 있었나
//   업무 추가 창(TaskCreateForm)이 첨부를 `/api/files` 로 올려 **올린 사람의 내 파일(L1)** 을 만든 뒤 업무에 연결했다.
//   업무 첨부 행(task_attachments)은 그 File 과 **같은 file_path** 를 가리키고, 첨부 사본 라우트는 원본 File 등급으로
//   판정한다(middleware/imageViewer.denyPrivateCopy · findSourceFile). 그래서 그 업무의 **담당자에게도 404** 였다.
//   v1.68.0 부터 새 첨부는 업무 첨부 라우트로 직접 올라간다(자기 File 행 없음 → 업무를 볼 수 있으면 첨부도 본다).
//
// 이 스크립트가 하는 것 (지정한 첨부 id 만)
//   ① 바이트를 **같은 폴더에 새 UUID 이름으로 복사**하고 크기·SHA-256 이 같은지 확인한다
//   ② 첨부 행의 stored_name·file_path 만 새 사본으로 바꾼다 — 업무 첨부 라우트가 만드는 행과 같은 모양(상대경로)
//   ③ 저장 용량 집계에 사본 크기를 더한다(force — 고치는 일을 쿼터가 막지 않게) · 감사 로그 1행
//   원본 File(올린 사람의 내 파일)·원본 바이트는 **건드리지 않는다**(사람의 자료다 — 지우지 않는다).
//
// 멱등: 첨부의 file_path 가 더 이상 L1 File 과 같지 않으면 «이미 처리» 로 건너뛴다.
// 안전장치: planq 저장 · 문서 첨부 아님 · 의뢰 명세 첨부 · 업로더 = 업무 작성자 · 같은 워크스페이스의 L1 File 과 경로 공유 —
//   하나라도 아니면 건너뛴다(조건 밖의 행을 고치지 않는다).
//
// 사용: node scripts/backfill-task-attach-444.js --ids 29,32,33,37,40            (dry-run)
//       node scripts/backfill-task-attach-444.js --ids 29,32,33,37,40 --apply    (적용 · 되돌리기 기록을 backups/ 에 남긴다)
//       node scripts/backfill-task-attach-444.js --rollback <기록 json>           (되돌리기: 행 복원 · 사본 삭제 · 집계 반환)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// 운영은 이 파일을 /tmp 로 복사해 돌린다(운영 코드 디렉터리를 손대지 않는다) — 백엔드 위치를 스스로 찾는다.
const BASE = fs.existsSync('/opt/planq/backend/models') ? '/opt/planq/backend' : path.join(__dirname, '..');
process.chdir(BASE);
require(`${BASE}/node_modules/dotenv`).config({ path: `${BASE}/.env`, quiet: true });
const { v4: uuidv4 } = require(`${BASE}/node_modules/uuid`);
const { sequelize } = require(`${BASE}/config/database`);
const { TaskAttachment, Task, File } = require(`${BASE}/models`);

const TAG = '[backfill-444]';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const idsArg = args.includes('--ids') ? args[args.indexOf('--ids') + 1] : '';
const IDS = String(idsArg || '').split(',').map(Number).filter(Boolean);
const ROLLBACK = args.includes('--rollback') ? args[args.indexOf('--rollback') + 1] : null;

const abs = (p) => (path.isAbsolute(p) ? p : path.join(BASE, p));
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const levelOf = (f) => f.vlevel || f.visibility || 'L4';

async function rollback(file) {
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { releasePlanqUpload } = require(`${BASE}/services/storageUsage`);
  for (const r of rec.rows) {
    const att = await TaskAttachment.findByPk(r.att_id);
    if (!att || att.file_path !== r.new_file_path) { console.log(TAG, `#${r.att_id} 이미 되돌렸거나 바뀜 — skip`); continue; }
    await att.update({ stored_name: r.old_stored_name, file_path: r.old_file_path });
    try { fs.unlinkSync(abs(r.new_file_path)); } catch { /* 이미 없음 */ }
    await releasePlanqUpload(r.business_id, r.file_size).catch(() => {});
    console.log(TAG, `#${r.att_id} 되돌림`);
  }
}

async function main() {
  if (ROLLBACK) { await rollback(ROLLBACK); return; }
  if (!IDS.length) { console.error('사용: --ids 1,2,3 [--apply] | --rollback <json>'); process.exitCode = 1; return; }
  const { reservePlanqUpload } = require(`${BASE}/services/storageUsage`);
  const { createAuditLog } = require(`${BASE}/services/auditService`);
  const done = [];
  // ★ 되돌리기 기록은 **행마다** 쓴다(Fable 2026-10-02) — 중간 행에서 터지면 앞 행들이 기록 없이 남는다.
  const recDir = path.join(BASE, '..', 'backups');
  const recFile = path.join(recDir, `backfill-444-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const saveRec = () => { fs.mkdirSync(recDir, { recursive: true }); fs.writeFileSync(recFile, JSON.stringify({ at: new Date().toISOString(), rows: done }, null, 2)); };
  for (const id of IDS) {
    const att = await TaskAttachment.findByPk(id);
    if (!att) { console.log(TAG, `#${id} 없음 — skip`); continue; }
    const why = [];
    if (att.storage_provider !== 'planq') why.push('planq 아님');
    if (att.post_id) why.push('문서 첨부');
    if (att.context !== 'description_attach') why.push(`context=${att.context}`);
    const task = await Task.findByPk(att.task_id, { attributes: ['id', 'business_id', 'created_by', 'assignee_id'] });
    if (!task || task.business_id !== att.business_id) why.push('업무 없음/워크스페이스 불일치');
    else if (task.created_by !== att.uploaded_by) why.push('업로더 ≠ 작성자');
    const src = await File.findOne({ where: { business_id: att.business_id, storage_provider: 'planq', file_path: att.file_path } });
    if (!src || levelOf(src) !== 'L1') { console.log(TAG, `#${id} 이미 처리(L1 원본과 경로 공유 안 함) — skip`); continue; }
    if (why.length) { console.log(TAG, `#${id} 조건 밖 — skip (${why.join(', ')})`); continue; }
    const from = abs(att.file_path);
    if (!fs.existsSync(from)) { console.log(TAG, `#${id} 원본 바이트 없음 ${from} — skip`); continue; }

    const ext = path.extname(att.stored_name || from).toLowerCase();
    const newName = `${uuidv4()}${ext}`;
    const relDir = path.relative(BASE, path.dirname(from)).replace(/\\/g, '/');
    const newRel = `${relDir}/${newName}`;
    console.log(TAG, `#${id} 업무 ${att.task_id} · ${att.original_name} · ${att.file_size}B · File#${src.id}(L1) → ${newRel}${APPLY ? '' : ' (dry-run)'}`);
    if (!APPLY) continue;

    fs.copyFileSync(from, abs(newRel), fs.constants.COPYFILE_EXCL);
    if (fs.statSync(abs(newRel)).size !== fs.statSync(from).size || sha(abs(newRel)) !== sha(from)) {
      fs.unlinkSync(abs(newRel));
      throw new Error(`#${id} 사본 검증 실패 — 중단(이 행은 바뀌지 않았다)`);
    }
    const old = { stored_name: att.stored_name, file_path: att.file_path };
    await att.update({ stored_name: newName, file_path: newRel });
    done.push({ att_id: att.id, business_id: att.business_id, file_size: Number(att.file_size || 0),
      old_stored_name: old.stored_name, old_file_path: old.file_path, new_file_path: newRel });
    saveRec();
    await reservePlanqUpload(att.business_id, Number(att.file_size || 0), { force: true });
    createAuditLog({
      userId: null, businessId: att.business_id, action: 'task_attachment.backfill_444',
      targetType: 'task_attachment', targetId: att.id,
      oldValue: old, newValue: { stored_name: newName, file_path: newRel, source_file_id: src.id },
    });
  }
  if (APPLY && done.length) console.log(TAG, `적용 ${done.length}건 · 되돌리기 기록 ${recFile}`);
  else if (APPLY) console.log(TAG, '적용 0건');
}

main().catch((e) => { console.error(TAG, '실패:', e.message); process.exitCode = 1; })
  .finally(() => setTimeout(() => sequelize.close().then(() => process.exit(process.exitCode || 0)), 2000));   // 감사 로그(fire-and-forget)가 착지할 시간
