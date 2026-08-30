// 본문에만 있고 파일 목록엔 없던 인라인 이미지 되살리기 (운영 #378 잔여분)
//
// 배경: `POST /api/posts/editor-image` 는 business_id 를 못 받으면 **File 행 없이** 파일만 저장했다.
//   그렇게 올라간 이미지는 문서 본문에는 멀쩡히 보이는데 파일 메뉴 어디에도 없다
//   (Irene: "파일로 첨부해도 안잡히네"). 쓰기측은 같은 커밋에서 막았고 — 이제 옛 것을 채운다.
//
// 방식: posts.content_json 안의 `/api/posts/editor-image/<파일명>` 참조를 전수로 훑어,
//   그 파일명을 가리키는 File 행이 없고 **디스크에 실물이 있는** 것만 등록한다.
//   files 에는 post_id 컬럼이 없으므로(연결 축은 본문 URL 뿐) 이 대조가 유일한 방법이다.
//
// 규칙 — 쓰기측(routes/posts.js editor-image)과 **같게** 맞춘다:
//   business_id  = 문서의 워크스페이스
//   project_id   = 문서의 프로젝트 (없으면 null)
//   vlevel/visibility = 프로젝트 있으면 L2, 없으면 L3 (권위 컬럼 동시 기록)
//   uploader_id  = 문서 작성자
//   content_hash = SHA-256 기록. **중복 제거는 하지 않는다** — 이 파일들은 이미 디스크에 각각
//                  존재하고, 본문 URL 이 그 파일명을 가리킨다. 다른 파일을 재사용하면 참조 파일명이
//                  DB 에 남지 않아 다음 실행이 같은 것을 또 만든다(멱등 파괴, 실측). 바이트도 안 준다.
//   created_at   = 문서 작성 시각 (파일 목록 정렬이 현실과 맞도록 — 오늘 올린 척하지 않는다)
//   파일명       = 원본 이름을 알 수 없다(UUID 만 남았다) → "<문서명> (본문 이미지 N).<확장자>"
//
// 멱등: 같은 파일명을 가리키는 File 행이 있으면 건너뛴다. 재실행 시 변경 0.
// 비파괴: 기존 행을 수정하지 않는다(ref_count 증가 제외). 물리 파일도 건드리지 않는다.
//
// 사용:
//   node scripts/backfill-orphan-editor-images.js            # 미리보기
//   node scripts/backfill-orphan-editor-images.js --apply    # 반영

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { File, Post, User } = require('../models');
const { sha256OfFile } = require('../utils/fileHash');
const { reservePlanqUpload } = require('../services/storageUsage');

const APPLY = process.argv.includes('--apply');
const DIR = path.join(__dirname, '..', 'uploads', 'editor-images');
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

function safeName(title, idx, ext) {
  const base = String(title || '문서').replace(/[\\/:*?"<>|\n\r]/g, ' ').trim().slice(0, 60) || '문서';
  return `${base} (본문 이미지 ${idx}).${ext}`;
}

(async () => {
  const posts = await Post.findAll({
    where: { content_json: { [Op.ne]: null } },
    // ★ 속성명은 camelCase — 'created_at' 로 고르면 인스턴스에 안 실려 아래 createdAt 이 undefined 가 되고,
    //   그러면 Sequelize 가 **현재 시각**을 넣어 옛 이미지가 오늘 올린 것처럼 목록 맨 위에 뜬다.
    attributes: ['id', 'title', 'business_id', 'project_id', 'author_id', 'createdAt', 'content_json'],
    order: [['id', 'ASC']],
  });

  // 본문 참조 수집
  const refs = [];
  for (const p of posts) {
    const raw = typeof p.content_json === 'string' ? p.content_json : JSON.stringify(p.content_json || {});
    const names = [...new Set([...raw.matchAll(/\/api\/posts\/editor-image\/([A-Za-z0-9._-]+)/g)].map((m) => m[1]))];
    names.forEach((fn, i) => refs.push({ post: p, fn, idx: i + 1 }));
  }
  if (!refs.length) { console.log('본문 인라인 이미지 참조 0건 — 할 일 없음.'); process.exit(0); }

  // 이미 등록된 파일명
  const known = new Set(
    (await File.findAll({ where: { file_path: { [Op.like]: '%editor-images%' } }, attributes: ['file_path'] }))
      .map((f) => path.basename(f.file_path)),
  );

  const targets = [];
  const missingOnDisk = [];
  for (const r of refs) {
    if (known.has(r.fn)) continue;
    const abs = path.join(DIR, r.fn);
    let st = null;
    try { st = fs.statSync(abs); } catch { /* 없음 */ }
    if (!st) { missingOnDisk.push(r); continue; }   // 바이트가 없으면 되살릴 것이 없다
    targets.push({ ...r, abs, size: st.size });
  }

  console.log(`본문 참조 ${refs.length}건 · 이미 등록 ${refs.length - targets.length - missingOnDisk.length}건`
    + ` · 되살릴 것 ${targets.length}건 · 실물 없음 ${missingOnDisk.length}건`);
  for (const r of missingOnDisk) console.log(`  [건너뜀] post ${r.post.id} ${r.fn} — 디스크에 파일 없음`);

  const authorIds = [...new Set(targets.map((t) => t.post.author_id).filter(Boolean))];
  const users = authorIds.length
    ? await User.findAll({ where: { id: { [Op.in]: authorIds } }, attributes: ['id'] }) : [];
  const validUser = new Set(users.map((u) => u.id));

  let created = 0; let bytes = 0;
  for (const t of targets) {
    const ext = (t.fn.split('.').pop() || 'png').toLowerCase();
    const level = t.post.project_id ? 'L2' : 'L3';
    const name = safeName(t.post.title, t.idx, ext);
    const hash = await sha256OfFile(t.abs);
    console.log(`  post ${t.post.id} [${level}${t.post.project_id ? ` proj=${t.post.project_id}` : ''}] `
      + `${t.fn} → "${name}" ${t.size}B`);
    if (!APPLY) continue;

    // 이미 디스크를 차지하고 있던 바이트다 — 사용량에 반영해야 쿼터가 현실과 맞는다.
    //   force: 되살리는 중에 한도를 넘겼다고 실패시키면 파일은 그대로 있고 목록만 반쪽이 된다.
    await reservePlanqUpload(t.post.business_id, t.size, { force: true });
    bytes += t.size;

    await File.create({
      business_id: t.post.business_id,
      project_id: t.post.project_id || null,
      uploader_id: validUser.has(t.post.author_id) ? t.post.author_id : null,
      file_name: name,
      file_path: t.abs,
      file_size: t.size,
      mime_type: MIME[ext] || 'application/octet-stream',
      storage_provider: 'planq',
      content_hash: hash,
      ref_count: 1,
      visibility: level,
      vlevel: level,
      // ★ 속성명은 camelCase 다 — `created_at` 로 주면 **조용히 무시**된다(underscored 는 컬럼명만 바꾼다).
      //   그리고 { silent:true } 를 주면 updatedAt 자동 갱신까지 막혀 NOT NULL 위반이 난다.
      createdAt: t.post.createdAt,
    });
    created += 1;
  }

  if (!APPLY) { console.log('\n미리보기입니다. 반영하려면 --apply'); process.exit(0); }
  console.log(`\n반영 완료 — File 행 ${created}건 생성 · 사용량 집계 ${bytes}B`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
