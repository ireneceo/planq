// services/driveFolderCleanup.js — 폴더를 지울 때 **Drive 쪽을 어떻게 정리하는가** 의 단일 지점.
//
// 왜 함수로 뺐나 (2026-09-17, Fable 10차 #5):
//   회귀 검사가 `routes/file_folders.js` 의 **소스 문자열**을 grep 하고 있었다
//   (`/항목이 남아 삭제하지 않음/`). 그 검사는 `continue` 한 줄만 지워도 **초록**이다 —
//   있는 검사가 언제나 초록이면 없는 검사보다 나쁘다. 규칙을 라우트 밖으로 꺼내
//   **가짜 drive 를 주입해 동작으로** 재도록 만든다(실 Drive 호출 0).
//
// 규칙 세 가지 (셋 다 피로 배운 것이다):
//   ① **자식 먼저, 루트 마지막.** 루트를 먼저 다루면 안에 하위 폴더가 남아 영영 안 지워진다.
//   ② **안의 것을 먼저 부모로 옮긴다.** PlanQ 는 파일을 부모 폴더로 옮기는데 Drive 사본만
//      옛 폴더에 남아 트리가 갈라졌다(Fable 10차 #6).
//   ③ **비어 있을 때만 지운다.** Drive `files.delete` 는 폴더 안 항목을 **휴지통 없이 영구 삭제**한다.
//      운영 실측 — 한 폴더 안에 Drive 원본 107건(로컬 사본 없음)이 있었다. 남는 편이 잃는 것보다 낫다.

/**
 * @param {object} drive   googleapis drive 클라이언트 (검사에서는 가짜를 넣는다)
 * @param {object} gdrive  services/gdrive (moveFile · deleteFile · isNotFoundError)
 * @param {string[]} driveFolderIds  지울 Drive 폴더 id — **자식 먼저** 정렬돼 있어야 한다
 * @param {string|null} destId  안의 것을 옮길 목적지. null 이면 옮기지 않는다(= 폴더를 남긴다)
 * @returns {{moved:number, deleted:string[], kept:string[], failed:number}}
 */
async function cleanupDriveFolders(drive, gdrive, driveFolderIds, destId) {
  const out = { moved: 0, deleted: [], kept: [], failed: 0 };
  const deletedSet = new Set(driveFolderIds);

  for (const fid of driveFolderIds) {
    // ② 안의 것을 부모로 옮긴다 — 같이 지울 하위 폴더는 건너뛴다(곧 지워진다).
    if (destId) {
      try {
        let pageToken;
        do {
          const kids = await drive.files.list({
            q: `'${fid}' in parents and trashed=false`,
            fields: 'nextPageToken, files(id)', pageSize: 200, pageToken,
            supportsAllDrives: true, includeItemsFromAllDrives: true,
          });
          for (const k of (kids.data.files || [])) {
            if (deletedSet.has(k.id)) continue;
            try { await gdrive.moveFile(drive, k.id, destId); out.moved += 1; }
            catch (e) { out.failed += 1; console.warn('[driveFolderCleanup] 이동 실패 — 폴더는 남긴다', k.id, e.message); }
          }
          pageToken = kids.data.nextPageToken;
        } while (pageToken);
      } catch (e) { console.warn('[driveFolderCleanup] 비우기 실패', fid, e.message); }
    }

    // ③ 비어 있을 때만 지운다.
    try {
      const kids = await drive.files.list({
        q: `'${fid}' in parents and trashed=false`,
        fields: 'files(id)', pageSize: 1,
        supportsAllDrives: true, includeItemsFromAllDrives: true,
      });
      if ((kids.data.files || []).length > 0) { out.kept.push(fid); continue; }
      await gdrive.deleteFile(drive, fid);
      out.deleted.push(fid);
    } catch (e) {
      if (gdrive.isNotFoundError && gdrive.isNotFoundError(e)) { out.deleted.push(fid); continue; }
      out.failed += 1;
      console.warn('[driveFolderCleanup] 폴더 삭제 실패', fid, e.message);
    }
  }
  return out;
}

module.exports = { cleanupDriveFolders };
