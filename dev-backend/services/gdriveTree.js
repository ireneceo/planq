// services/gdriveTree.js — "이 Drive 파일이 워크스페이스 폴더 **안**의 것인가" 판정.
//
// 왜 이게 격리 장치인가 (Fable 설계 게이트 A-1 / B-2, 2026-08-29)
//   v2 는 Restricted `drive` scope 를 쓴다. 그러면 Changes API 가 **연결한 사람의 개인 Drive
//   전체**의 변경을 준다 — 가족 사진도, 남의 회사 계약서도 온다. 그중 워크스페이스 폴더
//   하위의 것만 골라내지 못하면 개인 파일이 워크스페이스 L3(전 멤버 공개)로 유입된다.
//   테넌트 간 유출보다 이쪽이 실제 위험이다.
//
//   Drive 의 변경 알림은 **직계 부모 하나**만 준다(`parents[0]`). 사용자가 Drive 안에서
//   직접 만든 중간 폴더는 우리가 모르므로, 부모를 타고 **root 까지 올라가 봐야** 안다.
//
// 판정 원칙 — **fail-closed**
//   못 읽는 폴더(권한 밖·삭제됨·404)를 만나면 "밖" 으로 떨어뜨린다. 모르면 안 들인다.
//   지금 scope(`drive.file`)에서는 우리가 만들지 않은 폴더가 전부 404 라 **항상 밖**이 된다 —
//   이것은 고장이 아니라 정상 대기 상태다(로그 사유로 구별한다).
//
// 호출 폭발 방지
//   같은 폴더를 파일마다 다시 묻지 않게 한 번의 배치 안에서 캐시한다. 또한 이미 PlanQ 에
//   매핑된 폴더(`file_folders.gdrive_folder_id`)를 만나면 **거기서 멈춘다** — 그 폴더는
//   우리가 root 아래에 만든 것이므로 더 올라갈 이유가 없다.
const { FileFolder } = require('../models');

const MAX_DEPTH = 20;          // 현실적인 폴더 깊이 상한. 넘으면 '밖' 으로 (순환 방어 겸)
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

/** 배치 1회 동안 쓰는 캐시. 호출측이 만들어 넘긴다(요청 간 재사용 금지 — 폴더는 움직인다). */
function newCache() {
  return { folder: new Map() };
}

async function findMappedFolder(businessId, driveFolderId) {
  return FileFolder.findOne({ where: { business_id: businessId, gdrive_folder_id: driveFolderId } });
}

/**
 * 파일 하나의 조상을 걸어 올라가 root 하위인지 본다.
 *
 * @returns {{inRoot:boolean, folderId:number|null, chain:Array, reason:string}}
 *   folderId — PlanQ 의 어느 폴더에 놓을 것인가 (null = 파일함 루트)
 *   chain    — root 바로 아래부터 직계 부모까지, 아직 PlanQ 에 없는 폴더들 (위→아래 순)
 *   reason   — 판정 사유. 로그에 그대로 남겨 "대기" 와 "고장" 을 구별한다
 */
async function resolveAncestry(drive, ctx, fileMeta, cache) {
  const { rootFolderId, businessId } = ctx;
  if (!rootFolderId) return { inRoot: false, folderId: null, chain: [], reason: 'no_root_folder' };
  if (fileMeta?.mimeType === SHORTCUT_MIME) {
    // 바로가기는 실체가 다른 곳에 있다. 들이면 원본과 두 벌이 된다.
    return { inRoot: false, folderId: null, chain: [], reason: 'shortcut' };
  }

  let parents = Array.isArray(fileMeta?.parents) ? fileMeta.parents : [];
  if (parents.length === 0) return { inRoot: false, folderId: null, chain: [], reason: 'no_parents' };

  const pending = [];              // 아직 PlanQ 에 없는 조상들 (아래→위 순으로 쌓임)
  let current = parents[0];

  // 걸어 올라가며 만난 것을 **성공/실패 모두** 캐시한다.
  //   ★ 처음엔 실패 경로만 캐시했더니, root 까지 잘 올라간 경우가 캐시되지 않아
  //     같은 폴더를 파일마다 다시 물었다(검사에서 호출 2→4 로 드러남). 그게 호출 폭발이다.
  const remember = (inRoot, reason, anchorId) => {
    // pending 은 아래→위 순이다. 위(root 쪽)부터 잘라 각 노드의 체인을 만들어 준다.
    const topDown = [...pending].reverse();
    topDown.forEach((node, i) => {
      cache.folder.set(node.driveId, inRoot
        ? { inRoot: true, folderId: anchorId, chain: topDown.slice(0, i + 1) }
        : { inRoot: false, reason });
    });
  };

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (!current) { remember(false, 'orphan'); return { inRoot: false, folderId: null, chain: [], reason: 'orphan' }; }
    if (current === rootFolderId) {
      // root 에 닿았다 — root 자신은 PlanQ 파일함 루트(folder_id = null)에 대응한다.
      remember(true, 'ok', null);
      return { inRoot: true, folderId: null, chain: [...pending].reverse(), reason: 'ok' };
    }

    const cached = cache.folder.get(current);
    if (cached) {
      if (!cached.inRoot) return { inRoot: false, folderId: null, chain: [], reason: cached.reason || 'outside_root' };
      // 캐시된 조상 위쪽은 이미 안다 — 그 체인에 이번에 새로 본 것들을 이어 붙인다.
      const chain = [...(cached.chain || []), ...[...pending].reverse()];
      remember(true, 'ok', cached.folderId ?? null);
      return { inRoot: true, folderId: cached.folderId ?? null, chain, reason: 'ok' };
    }

    // 이미 매핑된 폴더면 거기서 멈춘다 — 우리가 root 아래에 만든 것이다.
    const mapped = await findMappedFolder(businessId, current);
    if (mapped) {
      cache.folder.set(current, { inRoot: true, folderId: mapped.id, chain: [] });
      remember(true, 'ok', mapped.id);
      return { inRoot: true, folderId: mapped.id, chain: [...pending].reverse(), reason: 'ok' };
    }

    // 모르는 폴더 — Drive 에 물어본다. 못 읽으면 **밖**이다(fail-closed).
    let meta;
    try {
      const r = await drive.files.get({ fileId: current, fields: 'id, name, parents, trashed, mimeType' });
      meta = r.data;
    } catch (e) {
      const code = e?.code || e?.response?.status || 0;
      // 404/403 = scope 밖. 지금 scope 에서는 이것이 **정상 대기**다.
      const reason = (code === 404 || code === 403) ? 'ingest_scope_missing' : 'ancestor_lookup_failed';
      cache.folder.set(current, { inRoot: false, reason });
      remember(false, reason);
      return { inRoot: false, folderId: null, chain: [], reason };
    }

    if (meta.trashed) {
      cache.folder.set(current, { inRoot: false, reason: 'ancestor_trashed' });
      remember(false, 'ancestor_trashed');
      return { inRoot: false, folderId: null, chain: [], reason: 'ancestor_trashed' };
    }

    pending.push({ driveId: meta.id, name: meta.name || 'Untitled' });
    const up = Array.isArray(meta.parents) ? meta.parents : [];
    current = up[0] || null;
  }

  remember(false, 'depth_exceeded');
  return { inRoot: false, folderId: null, chain: [], reason: 'depth_exceeded' };
}

/**
 * 조상 체인을 PlanQ 폴더로 만들어 두고(위→아래) 마지막 폴더의 id 를 돌려준다.
 * 멱등 — 이미 매핑된 것은 재사용한다.
 */
async function ensureFolderChain(businessId, createdBy, chain, startParentId = null) {
  let parentId = startParentId;
  for (const node of chain || []) {
    const existing = await findMappedFolder(businessId, node.driveId);
    if (existing) { parentId = existing.id; continue; }
    const created = await FileFolder.create({
      business_id: businessId,
      parent_id: parentId,
      name: String(node.name).slice(0, 200),
      gdrive_folder_id: node.driveId,
      created_by: createdBy,
    });
    parentId = created.id;
  }
  return parentId;
}

module.exports = { resolveAncestry, ensureFolderChain, newCache, MAX_DEPTH, SHORTCUT_MIME };
