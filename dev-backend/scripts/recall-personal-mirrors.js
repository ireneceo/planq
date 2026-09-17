#!/usr/bin/env node
/**
 * 자격을 잃은 Drive 미러 사본 회수 (2026-09-17, Fable 게이트 #57 2차 FAIL).
 *
 * 왜 필요한가
 *   미러는 **올리는 그 시점에만** 자격을 본다. 그 뒤에 자격을 잃어도 사본이 남았다:
 *     · 개인(L1) 파일   — 옛 규칙은 «연결계정 주인 본인 것이면 미러» 였다.
 *                        [파인더 공유]로 그 폴더를 팀원에게 여는 문이 생기면서 전제가 깨졌다.
 *                        운영 실측(biz1): 미러 59건 중 **L1 12건**.
 *     · 삭제된 파일     — trash·purge 어디에도 미러 처리가 없었다.
 *     · 대외비/내부용   — `security-level` 회수는 2026-09-17 에야 붙었다(그 전 전환분이 남아 있다).
 *   그 폴더가 곧 [파인더 공유]가 여는 폴더이므로, **열기 전에 거둬야 한다.**
 *   Drive 권한은 비가역이라 "열고 나서 정리" 가 성립하지 않는다.
 *
 * ★ 이 스크립트는 `gdriveMirror.isEligible` 의 L1 제외와 **한 벌**이다. 코드만 고치면 과거분이 남고,
 *   이것만 돌리면 새로 또 올라간다.
 *
 * 사용: node scripts/recall-personal-mirrors.js [--apply] [--business=<id>]
 *   기본은 **미적용(dry-run)**.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Op } = require('sequelize');
const { File } = require('../models');
const { recallDriveMirror } = require('../services/driveMirrorRecall');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const onlyBiz = (args.find((a) => a.startsWith('--business=')) || '').split('=')[1];

/** 지금 기준으로 이 파일이 미러를 가질 자격이 있는가 — `gdriveMirror.isEligible` 과 **같은 축**.
 *  ★ 런타임과 **한 벌**이어야 한다 (2026-09-17, Fable 3차 지적: 판정이 두 벌이었다).
 *    - 삭제: 런타임이 **trash 시점**에 거둔다(옛 코드는 purge 까지 기다렸다) → 여기도 `deleted_at` 기준.
 *      복구하면 런타임이 다시 미러하므로(routes/file_trash.js) 스크립트가 거둬도 잃지 않는다.
 *    - L2 + target_member_ids(프로젝트 없음): 청중이 제한됐는데 공유 폴더에 놓인다 → 제외.
 */
function shouldNotHaveMirror(f) {
  if (f.deleted_at) return '삭제됨';
  // ★ **판정을 여기서 다시 쓰지 않는다** (2026-09-17, Fable 9차 N2).
  //   손으로 적었더니 ⑮ 규칙(프로젝트 없는 L2)을 몰라 운영 2건을 놓쳤다 — 판정이 세 벌이 됐다.
  //   `isEligible` 이 정본이므로 그것을 직접 부른다(미러 유무는 빼고 묻는다 — 이미 미러돼 있으니까).
  const { isEligible } = require('../services/gdriveMirror');
  const plain = typeof f.get === 'function' ? f.get({ plain: true }) : f;
  // ★ `storage_provider` 를 **planq 로 덮어서** 묻는다 (2026-09-17, Fable 10차 #1).
  //   `isEligible` 첫 줄이 `storage_provider !== 'planq' → false` 라, Drive 원본(gdrive) 행은
  //   내용과 무관하게 **항상 «미러 대상 아님»** 이 됐다. 그러면 운영 148건이 전부 후보가 되어
  //   `files.get` 을 168회 치고, 여기서 묻고 싶은 것(«이 가시성·보안등급이면 공유 폴더에
  //   있어도 되는가»)에는 답하지 못한다. 저장소 종류는 이 질문의 축이 아니다.
  const eligible = isEligible({ ...plain, storage_provider: 'planq', gdrive_mirror_id: null, deleted_at: null },
    { connected_by: plain.uploader_id, root_folder_id: 'x' });
  if (eligible) return null;
  const level = plain.vlevel || plain.visibility || 'L3';
  if (level === 'L1') return '개인(L1)';
  if (level === 'L2' && !plain.project_id) return '프로젝트 없는 L2';
  if (plain.security_level && plain.security_level !== 'general') return `보안등급 ${plain.security_level}`;
  return '미러 대상 아님';
}

(async () => {
  const where = {
    gdrive_mirror_id: { [Op.ne]: null },
    storage_provider: 'planq',      // 로컬이 정본인 **사본만** 지운다
    ...(onlyBiz ? { business_id: Number(onlyBiz) } : {}),
  };
  // ★ **Drive 가 원본인 파일은 이 스크립트가 못 본다** (2026-09-17, Fable 8차 차단①).
  //   `storage_provider='gdrive'` 는 사본이 아니라 **그 파일 자체**라 지울 수 없다. 그런데 그런 행도
  //   `Workspace Files`(= 파인더 공유가 여는 폴더) 안에 있을 수 있다 — 운영 실측 **L1 개인 파일 2건**.
  //   여태 필터에 걸려 «0건» 으로 보고했다. **못 지우는 것과 없는 것은 다르다** — 세어서 알린다.
  //   (옮기는 것은 바이트를 건드리지 않으므로 안전하지만, 사용자 Drive 구조를 바꾸는 일이라
  //    이 스크립트는 **알리기만** 하고 이동은 사람이 결정한다.)
  // 삭제된 것도 대상이므로 paranoid 기본 스코프를 쓰지 않는다.
  const rows = await File.findAll({ where, paranoid: false });

  // 못 지우는 것(Drive 원본)을 먼저 드러낸다 — 0건으로 보고하면 «깨끗하다» 는 거짓이 된다.
  const originRows = await File.findAll({
    where: {
      storage_provider: 'gdrive',
      ...(onlyBiz ? { business_id: Number(onlyBiz) } : {}),
    },
    paranoid: false,
  });
  const originCand = originRows.map((f) => ({ f, why: shouldNotHaveMirror(f) })).filter((x) => x.why);
  // ★ **DB 만으로는 «공유 폴더 안에 있는가» 를 모른다.** 자격 없는 Drive 원본이라도 프로젝트 폴더나
  //   Conversations 안에 있으면 [파인더 공유]가 여는 면이 아니다. 그걸 구분 안 하고 세면
  //   «22건 위험» 같은 과장이 되고, 사람이 그 숫자를 무시하게 된다.
  //   그래서 **Drive 에서 부모를 직접 읽어** 공유 폴더 직계인 것만 고른다.
  const originBad = [];
  let originUnreadable = 0;
  if (originCand.length) {
    const gdrive = require('../services/gdrive');
    const mirrorSvc = require('../services/gdriveMirror');
    const wsfCache = new Map();   // business_id → { wsf, drive }
    for (const item of originCand) {
      const { f } = item;
      try {
        if (!wsfCache.has(f.business_id)) {
          const tk = await gdrive.getTokenForBusiness(f.business_id);
          if (!tk) wsfCache.set(f.business_id, null);
          else {
            const dr = await gdrive.getDriveClient(tk);
            // ★ **찾기만** 한다 — dry-run 이 폴더를 만들면 안 된다 (Fable 10차 #7).
            wsfCache.set(f.business_id, { wsf: await mirrorSvc.findWorkspaceFilesFolder(dr, tk), drive: dr });
          }
        }
        const ctx = wsfCache.get(f.business_id);
        if (!ctx || !ctx.wsf || !f.external_id) { originUnreadable += 1; continue; }
        // ★ `parents` 를 **명시해서** 읽는다 (2026-09-17, Fable 9차 C2).
        //   `gdrive.getFileMeta` 의 fields 에는 `parents` 가 없다 — 그래서 `parents` 가 늘 undefined 였고
        //   `includes(wsf)` 가 **영원히 false** 였다. 즉 이 검사는 **항상 «노출 아님»** 을 보고했다.
        //   있는 검사가 언제나 초록이면 없는 검사보다 나쁘다(안심을 준다).
        const meta = await ctx.drive.files.get({
          fileId: f.external_id, fields: 'id, parents, trashed', supportsAllDrives: true,
        });
        const parents = (meta && meta.data && meta.data.parents) || [];
        if (parents.includes(ctx.wsf)) originBad.push(item);
      } catch (e) {
        // ★ 못 읽은 것을 **세지 않으면** 조용히 «안전» 이 된다. 세어서 종료코드에 넣는다.
        originUnreadable += 1;
      }
    }
  }
  if (originUnreadable) {
    console.log(`\n⚠ Drive 에서 위치를 **못 읽은** Drive 원본 ${originUnreadable}건 — 노출 여부를 확답할 수 없다.`);
  }
  if (originBad.length) {
    console.log(`\n⚠ **공유 폴더(Workspace Files) 안에 있는 Drive 원본** ${originBad.length}건 — 이 스크립트는 못 지운다`);
    console.log('   (사본이 아니라 그 파일 자체다. 지우면 파일이 사라진다.)');
    console.log('   [파인더 공유]를 열기 전에 Drive 에서 다른 폴더로 옮기거나 PlanQ 에서 등급을 바꿀 것.');
    for (const { f, why } of originBad.slice(0, 20)) {
      console.log(`   · id=${f.id} biz=${f.business_id} [${why}] ${f.file_name}`);
    }
    if (originBad.length > 20) console.log(`   … 외 ${originBad.length - 20}건`);
  } else if (originCand.length) {
    console.log(`\n· 자격 없는 Drive 원본 ${originCand.length}건은 공유 폴더 **밖**에 있다(프로젝트·대화 폴더) — 노출 아님`);
  }

  const targets = rows.map((f) => ({ f, why: shouldNotHaveMirror(f) })).filter((x) => x.why);
  console.log(`미러 보유 ${rows.length}건 중 회수 대상 ${targets.length}건`);
  const byWhy = {};
  for (const t of targets) byWhy[t.why] = (byWhy[t.why] || 0) + 1;
  Object.entries(byWhy).forEach(([k, v]) => console.log(`  · ${k}: ${v}건`));

  if (!APPLY) { console.log('적용하려면 --apply'); process.exit(0); }

  // ★ 결과를 **가려서 센다** (2026-09-17, Fable 지적).
  //   `shared` 는 산 형제가 같은 사본을 쓰는 경우다 — 사본은 **남는다**. 그런데 이것을 «회수» 로
  //   묶어 세면 다음 실행에 같은 행이 또 잡히고, 수치는 "매번 N건 거뒀다" 로 **거짓 안심**을 준다.
  //   무엇이 실제로 사라졌고 무엇이 남았는지 따로 말한다.
  let removed = 0; let shared = 0; let failed = 0;
  for (const { f, why } of targets) {
    const patch = {};
    const r = await recallDriveMirror(f, patch);
    if (r === 'removed') { await f.update(patch, { hooks: false }); removed += 1; }
    else if (r === 'shared') { if (Object.keys(patch).length) await f.update(patch, { hooks: false }); shared += 1; }
    else { failed += 1; console.warn(`  ✗ id=${f.id} (${why}) → ${r}`); }
  }
  console.log(`사본 제거 ${removed}건 · 형제가 같이 쓰는 중 ${shared}건(사본 유지) · 실패 ${failed}건`);
  if (shared) console.log('  ※ 형제 공유분은 그 형제가 지워질 때 purge 가 거둔다 — 다시 세어도 줄지 않는다.');
  if (originBad.length) console.log(`  ※ 위 Drive 원본 ${originBad.length}건은 여전히 남아 있다 — 사람이 처리해야 한다.`);
  // Drive 원본 잔여가 있으면 **0 으로 끝내지 않는다** — 배포 체인이 «깨끗함» 으로 읽으면 안 된다.
  process.exit(failed || originBad.length || originUnreadable ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
