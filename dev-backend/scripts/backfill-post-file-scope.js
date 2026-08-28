// #378 백필 — 문서 본문/첨부로 들어간 파일의 project_id·노출범위를 그 문서에 맞춘다.
//   근본원인(업로드 경로가 project 를 안 받던 것)은 고쳤다. 이건 **이미 쌓인 것** 정리.
//   ★ 넓히기 한 방향뿐 — 좁히면 이미 보던 사람이 못 보게 된다.
//   ★ 문서가 L1(임시저장/나만보기) 이면 손대지 않는다.
const { sequelize } = require('../config/database');
const APPLY = process.argv.includes('--apply');
const RANK = { L1: 1, L2: 2, L3: 3, L4: 4 };
// target_member_ids 는 JSON 컬럼 — 드라이버가 문자열로 줄 때가 있다(정본은 DB 형태).
function parseMembers(v) {
  if (!v) return [];
  try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a : []; } catch { return []; }
}

(async () => {
  // (1) 첨부 — post_attachments 로 명시 연결된 것
  const [attRows] = await sequelize.query(`
    SELECT f.id AS fid, f.file_name, f.project_id AS f_proj, f.vlevel AS f_lv,
           p.id AS pid, p.project_id AS p_proj, p.vlevel AS p_lv, p.status AS p_status, p.title,
           p.target_member_ids AS p_members
      FROM post_attachments pa
      JOIN posts p ON p.id = pa.post_id
      JOIN files f ON f.id = pa.file_id AND f.deleted_at IS NULL`);

  // (2) 본문 인라인 이미지 — files 에 post_id 컬럼이 **없다**. 연결은 content_json 안의 URL 뿐이다.
  //   /api/posts/editor-image/<uuid>.<ext> 를 긁어 files.file_path 의 basename 과 맞춘다.
  //   (모델을 믿지 말고 실제 저장 형태를 따라간다 — 파일명은 UUID, 원본명은 file_name 에 따로 있다)
  const [postRows] = await sequelize.query(
    `SELECT id, project_id, vlevel, status, title, target_member_ids, content_json
       FROM posts WHERE content_json IS NOT NULL`);
  const nameToPost = new Map();
  const RE = /\/api\/posts\/editor-image\/([0-9a-zA-Z_-]+\.[a-zA-Z0-9]+)/g;
  for (const p of postRows) {
    const raw = typeof p.content_json === 'string' ? p.content_json : JSON.stringify(p.content_json || '');
    let m; RE.lastIndex = 0;
    while ((m = RE.exec(raw))) if (!nameToPost.has(m[1])) nameToPost.set(m[1], p);
  }
  const inlineRows = [];
  if (nameToPost.size > 0) {
    const [files] = await sequelize.query(
      // ★ 괄호 필수 — AND 가 OR 보다 먼저 묶여 삭제된 파일이 섞여 들어온다.
      `SELECT id, file_name, file_path, project_id, vlevel FROM files
        WHERE deleted_at IS NULL AND file_path LIKE '%editor-images%'`);
    for (const f of files) {
      const base = String(f.file_path || '').split('/').pop();
      const p = nameToPost.get(base);
      if (!p) continue;
      inlineRows.push({ fid: f.id, file_name: f.file_name, f_proj: f.project_id, f_lv: f.vlevel,
        pid: p.id, p_proj: p.project_id, p_lv: p.vlevel, p_status: p.status, title: p.title,
        p_members: p.target_member_ids });
    }
  }
  console.log(`본문 이미지 참조 ${nameToPost.size}개 → files 매칭 ${inlineRows.length}건`);

  const seen = new Set();
  const rows = [...attRows, ...inlineRows].filter(r => {
    const k = `${r.fid}:${r.pid}`; if (seen.has(k)) return false; seen.add(k); return true;
  });

  const skipped = [];
  const fixes = [];
  for (const r of rows) {
    const docLv = r.p_lv || (r.p_proj ? 'L2' : 'L3');
    if (r.p_status === 'draft' || docLv === 'L1' || docLv === 'L4') continue;  // 아직 남에게 보일 글이 아니다
    const needProj = r.p_proj != null && r.f_proj !== r.p_proj;
    let needLv = RANK[r.f_lv || 'L1'] < RANK[docLv];
    // ★ L2 는 "프로젝트" 또는 "대상 멤버" 중 하나가 있어야 볼 사람이 정해진다.
    //   둘 다 없는 L2 로 올리면 files 술어에는 작성자 예외 조항이 **없어서**
    //   업로더 본인조차 못 보게 된다 — 원래 버그보다 나쁘다. 그런 문서는 건너뛴다.
    const members = parseMembers(r.p_members);
    if (needLv && docLv === 'L2' && r.p_proj == null && members.length === 0) {
      skipped.push(`file#${r.fid} (문서#${r.pid} 는 L2 인데 프로젝트도 대상 멤버도 없어 볼 사람이 정해지지 않았다)`);
      needLv = false;
    }
    if (!needProj && !needLv) continue;
    fixes.push({
      fid: r.fid, name: r.file_name, pid: r.pid, title: r.title,
      from: `${r.f_lv || '-'}/${r.f_proj ?? '-'}`,
      to: `${needLv ? docLv : (r.f_lv || '-')}/${needProj ? r.p_proj : (r.f_proj ?? '-')}`,
      lv: needLv ? docLv : null, proj: needProj ? r.p_proj : null,
      members: needLv && docLv === 'L2' && r.p_proj == null ? members : null,
    });
  }

  console.log(`검사 ${rows.length}건 · 고칠 것 ${fixes.length}건`);
  if (skipped.length) { console.log('건너뜀:'); skipped.forEach(x => console.log('  ' + x)); }
  for (const f of fixes) console.log(`  file#${f.fid} ${String(f.name).slice(0, 40)}  ${f.from} → ${f.to}   (문서#${f.pid} ${String(f.title).slice(0, 30)})`);

  if (!APPLY) { console.log('\n적용하려면 --apply'); await sequelize.close(); return; }
  for (const f of fixes) {
    const set = [], rep = { id: f.fid };
    if (f.lv) { set.push('vlevel = :lv', 'visibility = :lv'); rep.lv = f.lv; }   // 권위 컬럼 둘 다
    if (f.proj != null) { set.push('project_id = :proj'); rep.proj = f.proj; }
    if (f.members && f.members.length) { set.push('target_member_ids = :mem'); rep.mem = JSON.stringify(f.members); }
    await sequelize.query(`UPDATE files SET ${set.join(', ')} WHERE id = :id`, { replacements: rep });
  }
  console.log(`\n적용 완료 — ${fixes.length}건`);
  await sequelize.close();
})().catch(e => { console.error(e.message); process.exit(1); });
