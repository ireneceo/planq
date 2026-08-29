// services/fileOrigin.js — "이 파일의 정본은 어디인가" 의 **단일 판정**.
//
// 왜 헬퍼로 뽑는가 (Fable 설계 게이트 B-1, 2026-08-29)
//   `storage_provider` 하나가 두 의미를 겸직하고 있었다 — 정본 축과 서빙 축.
//   v2 인제스트 파일은 **정본=Drive · 서빙 바이트=PlanQ** 라 한 컬럼으로 표현할 수 없다.
//   축을 갈랐으면 판정도 한 곳이어야 한다. `storage_provider==='gdrive' || origin==='gdrive'`
//   같은 이중 공식을 만들면 그 순간 두 벌이 되고, PlanQ 에서 이미 여러 번 갈라졌다
//   (memory: 같은 값의 공식이 여러 벌이면 이미 갈라져 있다).
//
// 두 축의 의미
//   · storage_provider — **서빙**: 바이트를 어디서 읽어 내려주는가 ('planq' 로컬 · 'gdrive' 원격 · 's3')
//   · origin_provider  — **정본**: 변경의 진실이 어디에 있는가 (NULL = PlanQ 가 정본)
//
// 조합이 뜻하는 것
//   planq / NULL    — 평범한 업로드 파일. Drive 사본은 미러일 뿐(gdrive_mirror_id).
//   gdrive / gdrive — 원격 참조 파일(현행 v1). 바이트도 Drive 에 있다.
//   planq / gdrive  — **v2 인제스트**. Drive 가 정본인데 바이트는 내려받아 우리가 서빙한다.
const { Op } = require('sequelize');

/** Drive 의 변경을 이 파일에 반영해야 하는가. (삭제·내용수정 반영의 유일한 기준) */
function isDriveMaster(file) {
  return !!file && file.origin_provider === 'gdrive';
}

/** 바이트를 우리가 직접 서빙하는가. (다운로드·미리보기 경로 판단) */
function servesLocalBytes(file) {
  return !!file && file.storage_provider === 'planq';
}

/** v2 인제스트로 들어온 파일인가 — Drive 가 정본인데 바이트는 우리가 가진 것. */
function isIngested(file) {
  return isDriveMaster(file) && servesLocalBytes(file);
}

/**
 * 인제스트 파일이 워크스페이스 밖으로 나갔거나(root 이탈) 사용자가 PlanQ 에서 지웠을 때,
 * **Drive 원본은 건드리지 않고** 연결만 끊는 patch.
 *   Fable B-4-① — 워크스페이스 정리로 개인 Drive 파일이 증발하면 안 된다.
 *   Fable B-3 조건② — 이후 복구되면 planq 정본으로 살아간다(재동기화 시도 없음).
 */
function detachFromDrivePatch() {
  return { origin_provider: null, external_id: null, external_url: null, drive_md5: null };
}

/** 아직 백필 전 데이터를 만나면 알아채기 위한 점검(운영 가시성용, 0 이어야 정상). */
async function countUnmigrated(FileModel) {
  return FileModel.count({ where: { storage_provider: 'gdrive', origin_provider: { [Op.is]: null } } });
}

module.exports = { isDriveMaster, servesLocalBytes, isIngested, detachFromDrivePatch, countUnmigrated };
