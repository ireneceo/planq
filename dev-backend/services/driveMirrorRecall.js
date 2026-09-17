// services/driveMirrorRecall.js — Drive **미러 사본을 거두는 단일 지점** (2026-09-17, Fable 게이트 #57 2차 FAIL)
//
// 왜 이 파일이 있는가
//   미러(`gdriveMirror.isEligible`)는 **올리는 그 시점에만** 자격을 본다. 그 뒤에 자격을 잃어도
//   Drive 사본은 그대로 남았다. 회수 코드가 `PUT /security-level` **한 곳에만** 있었기 때문이다.
//   Fable 이 실 Drive 로 재현한 것:
//     · `PUT /visibility {level:'L1'}` (개인으로 내림) → 미러가 Workspace Files 에 **그대로**
//     · trash → purge 까지 해도 **Drive 사본이 살아 있다**
//   그리고 그 폴더가 곧 [파인더 공유]가 여는 폴더다 — 남의 개인 파일과 지운 파일이 같이 열린다.
//   Drive 권한은 비가역이라 "나중에 정리" 가 성립하지 않는다.
//
// 계약
//   · **로컬 바이트가 정본인 미러 사본만** 지운다(`storage_provider === 'planq'`).
//     `storage_provider === 'gdrive'` 는 Drive 가 원본이라 지우면 파일 자체가 사라진다 — 손대지 않는다.
//   · 실패해도 **본 작업을 막지 않는다.** 다만 **조용히 넘어가지 않는다** — 결과를 돌려주고
//     호출측이 응답·원장에 싣는다.
//   · 멱등하다. 이미 없으면 `'none'`.
//
/**
 * 그 사본을 가리키던 **다른 모든 행**의 포인터를 비운다(휴지통 행 포함).
 * 포인터는 **사본이 살아 있는 동안만** 뜻이 있다 — 사라지면 같이 지운다.
 * 안 비우면 ①복구해도 `isEligible` 이 «이미 미러됨» 으로 읽어 영영 재미러되지 않고
 * ②`gdriveApply` 가 그 행을 집어 엉뚱한 곳에 Drive 변경을 붙인다(둘 다 Fable 5차 실측).
 */
async function clearSiblingPointers(file, mirrorId, t) {
  if (!mirrorId) return;
  try {
    const { Op } = require('sequelize');
    const { File } = require('../models');
    await File.update(
      { gdrive_mirror_id: null, gdrive_mirror_url: null, gdrive_mirrored_at: null },
      {
        where: { business_id: file.business_id, gdrive_mirror_id: mirrorId, id: { [Op.ne]: file.id } },
        ...(t ? { transaction: t } : {}),
      },
    );
  } catch (e) {
    console.warn('[driveMirrorRecall] 형제 포인터 정리 실패', file.id, e.message);
  }
}

// 반환: 'removed' | 'shared'(산 형제가 같은 사본을 쓴다 — 내 컬럼만 비웠다) | 'none' | 'is_origin' | 'failed'
async function recallDriveMirror(file, patch = {}, opts = {}) {
  if (!file || !file.gdrive_mirror_id) return 'none';
  if (file.storage_provider === 'gdrive') return 'is_origin';
  if (file.storage_provider !== 'planq') return 'none';
  // ★★ **같은 미러를 나눠 쓰는 산 형제가 있으면 Drive 사본을 지우지 않는다** (2026-09-17, Fable 3차 FAIL).
  //   `routes/posts.js` 의 쌍둥이(twin) 생성은 같은 바이트에 **같은 `gdrive_mirror_id` 를 물려준다**
  //   (백필 `byHash` 도 같다). 그래서 한 행만 회수해도 **살아 있는 문서의 이미지 사본이 사라졌다**
  //   — Fable 이 실 Drive 로 재현했고 운영에 같은 미러를 쓰는 행이 5개 있다.
  //   바이트 카운터에 적용한 `lastRef` 와 **같은 생각**이다: 물리 객체가 하나면 마지막 참조만 지운다.
  //   형제가 있으면 **내 컬럼만 비운다** — 내 행은 더 이상 그 사본을 가리키지 않지만 사본은 남는다.
  try {
    const { Op } = require('sequelize');
    const { File } = require('../models');
    // 같은 사본을 나눠 쓰는 **산 형제**가 있는지 센다 (`posts.js` 쌍둥이·백필 `byHash`).
    //   ★ 잠그지 않는다 — `FOR UPDATE` 로 직렬화하려다 **교착**이 났다(2026-09-17 실측
    //     `Deadlock found`: 두 트랜잭션이 이미 자기 행을 잡은 채 서로의 행을 원한다).
    //     대신 **삭제 경로에서는 포인터를 남겨** 고아를 구조적으로 막는다(아래 `shared` 분기).
    const t = opts.transaction || null;
    const siblings = await File.count({
      where: {
        business_id: file.business_id,
        gdrive_mirror_id: file.gdrive_mirror_id,
        deleted_at: null,
        id: { [Op.ne]: file.id },
      },
      ...(t ? { transaction: t } : {}),
    });
    if (siblings > 0) {
      // ★★ **삭제 경로에서는 포인터를 지우지 않는다** — 고아를 구조적으로 막는 유일한 방법이다.
      //   (2026-09-17, Fable 4차 실측 + 내 교착 실험)
      //   처음엔 `FOR UPDATE` 로 직렬화하려 했다. **교착이 난다**: 두 트랜잭션이 이미 자기 행을 잡은
      //   채 서로의 행을 원한다(실측: `Deadlock found when trying to get lock`).
      //   잠금 없이 세면 동시 삭제에서 **둘 다 형제를 보고** `'shared'` 가 된다 — 그때 양쪽이 포인터를
      //   비우면 **DB 어디에도 없는 사본**이 공유 폴더에 남는다(purge 그물도 회수 스크립트도 못 찾는다).
      //   그래서 **포인터를 남긴다.** 행은 어차피 삭제된 상태이고, 나중에 `filePurge` 가 그 행을
      //   영구삭제할 때 형제가 이미 없으므로 **마지막 참조로 판정해 사본을 지운다.**
      //   포인터가 곧 안전선이다 — 비우는 순간 추적이 끊긴다.
      //   ★ 살아 있는 행이 **자격만 잃은 경우**(L1 전환·대외비)는 다르다. 그 행은 더 이상 그 사본의
      //     주인이 아니므로 포인터를 비워야 한다. 사본은 여전히 자격 있는 형제가 가리키므로 고아가
      //     아니다. 그 경우만 `clearOnShared: true` 로 부른다.
      if (opts.clearOnShared) {
        patch.gdrive_mirror_id = null;
        patch.gdrive_mirror_url = null;
        patch.gdrive_mirrored_at = null;
      }
      return 'shared';
    }
    const gdrive = require('./gdrive');
    const token = await gdrive.getTokenForBusiness(file.business_id);
    if (!token) return 'failed';
    const drive = await gdrive.getDriveClient(token);
    const mirrorId = file.gdrive_mirror_id;
    await gdrive.deleteFile(drive, mirrorId);
    // ★★ **사본을 지웠으면 그것을 가리키던 포인터를 전부 비운다** (2026-09-17, Fable 5차 FAIL).
    //   삭제 경로가 포인터를 남기는 설계라(위) 휴지통 형제들이 같은 미러 id 를 들고 있다.
    //   여기서 안 비우면 그 행들은 **죽은 포인터**를 든 채가 되고 — Fable 실측 두 가지가 그것이다:
    //     ① 복구해도 `isEligible` 이 «이미 미러됨» 으로 읽어 **영영 재미러되지 않는다**
    //        (그리고 `gdrive_mirror_url` 이 죽은 링크로 남는다)
    //     ② Drive 변경 동기화(`gdriveApply`)가 그 행을 집어 엉뚱한 곳에 이름변경을 붙인다
    //   포인터는 **사본이 살아 있는 동안만** 뜻이 있다. 사라지면 같이 지운다.
    await clearSiblingPointers(file, mirrorId, t);
    patch.gdrive_mirror_id = null;
    patch.gdrive_mirror_url = null;
    patch.gdrive_mirrored_at = null;
    return 'removed';
  } catch (e) {
    // ★ **이미 없으면 성공이다** (2026-09-17 실측으로 잡음).
    //   Drive 에서 손으로 지웠거나 앞서 회수했으면 `File not found`(404) 가 온다. 그것을 `failed`
    //   로 보고하면 회수 스크립트가 **영원히 실패로 남고**, `security-level` 응답도 거짓이 된다
    //   (사본이 없는데 "못 지웠다" 고 말한다). 원하는 끝 상태에 이미 있으므로 멱등하게 성공 처리하고
    //   **DB 의 죽은 미러 id 도 같이 지운다** — 안 지우면 그 행이 계속 회수 대상으로 잡힌다.
    if (require('./gdrive').isNotFoundError(e)) {
      // ★ **여기서도 형제를 비운다** (2026-09-17 실측으로 잡음).
      //   사본이 이미 없으면 형제의 포인터는 **더더욱** 죽은 값이다. 성공 경로에만 두었다가
      //   이 경로로 빠지면 형제가 죽은 포인터를 든 채 남았다 — 반증 테스트가 그것을 잡았다.
      await clearSiblingPointers(file, file.gdrive_mirror_id, opts.transaction || null);
      patch.gdrive_mirror_id = null;
      patch.gdrive_mirror_url = null;
      patch.gdrive_mirrored_at = null;
      return 'removed';
    }
    console.warn('[driveMirrorRecall] 실패', file.id, e.message);
    return 'failed';
  }
}

module.exports = { recallDriveMirror };
