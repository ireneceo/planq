// canary-drive-mirror — Drive 미러 **생명주기 전 전이** (2026-09-17)
//
//   왜 이 카나리가 있는가
//     [파인더 공유]가 생기면서 `Workspace Files` 폴더가 **남에게 열리는 면**이 됐다. 그 순간부터
//     미러 생명주기의 모든 전이가 «누가 무엇을 볼 수 있는가» 를 정한다. 그런데 그 생명주기는
//     상태가 많다 — 산 행/휴지통/퍼지/자격상실/쌍둥이(같은 사본을 나눠 쓰는 행)/Drive 쪽 변경.
//     2026-09-17 에 그 경로들을 **하나씩** 고치다 Fable 게이트에서 여섯 번 연속으로 막혔다.
//     매번 «안 본 경로»에서 새 구멍이 났다. 그래서 경로가 아니라 **표**로 건다.
//
//   ★ 여기 걸리면 «누군가에게 안 보여야 할 것이 Drive 로 보인다» 는 뜻이다. Drive 권한은
//     우리 쪽 롤백으로 회수되지 않으므로, 이 검사는 배포 전에 반드시 초록이어야 한다.
//
//   ★ **실 Drive 를 아예 안 부르는 것은 아니다** (2026-09-17 정정 — 주석이 거짓이었다).
//     합성 미러 id 를 쓰지만 «마지막 참조» 분기는 `drive.files.delete` 를 실제로 친다.
//     가짜 id 이므로 **404 경로만** 타고(성공 경로는 여기서 못 잰다), 워크스페이스에 Drive 토큰이
//     없으면 그 항목이 `failed` 로 빨간불이 된다. 실 Drive 왕복의 성공 경로는 Fable 게이트가 친다.
//   ★ `applyChange` 는 `gdrive_sync_logs` 에 행을 남긴다 — 이 카나리가 **자기 흔적을 지운다**
//     (안 지우면 원장이 검사 기록으로 더러워진다).
const db = require('/opt/planq/dev-backend/models');
const mirror = require('/opt/planq/dev-backend/services/gdriveMirror');
const { recallDriveMirror } = require('/opt/planq/dev-backend/services/driveMirrorRecall');
const gdriveApply = require('/opt/planq/dev-backend/services/gdriveApply');

const BIZ = Number(process.env.CANARY_BIZ || 3);
const TOKEN = { connected_by: 3, root_folder_id: 'root', workspace_folder_id: 'wsf' };
const base = (over) => ({
  storage_provider: 'planq', gdrive_mirror_id: null, deleted_at: null,
  file_size: 1, uploader_id: 3, vlevel: 'L3', visibility: 'L3', security_level: 'general',
  project_id: null, target_member_ids: null, ...over,
});

async function run() {
  const results = [];
  const push = (name, ok, detail) => results.push({ name, route: name, leaked: !ok, detail });
  const made = [];
  const seq = db.File.sequelize;
  const mk = async (over) => {
    const f = await db.File.create({
      business_id: BIZ, file_name: 'canary-mirror.bin',
      file_path: `/tmp/pq-canary-${Date.now()}${Math.random()}.bin`,
      mime_type: 'application/octet-stream', ref_count: 1,
      gdrive_mirror_url: 'https://drive.google.com/x', gdrive_mirrored_at: new Date(),
      ...base(over),
    });
    made.push(f.id);
    return f;
  };

  try {
    // ── A. 무엇이 공유 폴더에 올라가는가 ──────────────────────────────
    //   여기가 틀리면 **올리면 안 되는 것이 공유 폴더에 놓인다.**
    for (const [label, over, want] of [
      ['L3 일반', {}, true],
      ['L1 개인', { vlevel: 'L1' }, false],
      ['L2+프로젝트', { vlevel: 'L2', project_id: 7 }, true],
      ['L2+특정멤버(프로젝트 없음)', { vlevel: 'L2', target_member_ids: [5] }, false],
      // ★ 프로젝트가 하드삭제되면 `resolveDriveParent` 가 **공유 폴더로 폴백**한다 —
      //   프로젝트 멤버만 보던 파일이 워크스페이스 전원에게 열리는 자리(Fable 8차 ⑮).
      ['L2+프로젝트 없음(타겟도 없음)', { vlevel: 'L2' }, false],
      ['대외비', { security_level: 'confidential' }, false],
      ['내부용', { security_level: 'internal' }, false],
      ['삭제됨', { deleted_at: new Date() }, false],
      ['gdrive 원본', { storage_provider: 'gdrive' }, false],
    ]) {
      const got = mirror.isEligible(base(over), TOKEN);
      push(`미러대상/${label}`, got === want, `기대 ${want} · 실제 ${got}`);
    }

    // ── B. 회수 — 자격을 잃으면 사본이 사라지는가 ─────────────────────
    {
      const a = await mk({ gdrive_mirror_id: `CAN1-${Date.now()}` });
      const p = {};
      const r = await recallDriveMirror(a, p);
      push('회수/단독행은 사본을 지운다', r === 'removed', r);
      push('회수/mirrored_at 도 지운다(의도된 회수)', p.gdrive_mirrored_at === null, String(p.gdrive_mirrored_at));
    }
    {
      // 삭제 경로: 포인터를 **남긴다** — 비우면 DB 어디에도 없는 고아 사본이 된다
      const M = `CAN2-${Date.now()}`;
      const a = await mk({ gdrive_mirror_id: M }); const b = await mk({ gdrive_mirror_id: M });
      const p = {};
      const r = await recallDriveMirror(a, p);
      push('회수/산 형제가 있으면 사본을 남긴다', r === 'shared', r);
      push('회수/삭제 경로는 포인터를 남긴다(고아 방지)', Object.keys(p).length === 0, JSON.stringify(p));
      await b.reload();
      push('회수/형제 포인터는 그대로', b.gdrive_mirror_id === M, b.gdrive_mirror_id || '(비움)');
    }
    {
      // 자격상실 경로(L1 전환 등): 내 포인터만 비운다 — 사본은 자격 있는 형제 것
      const M = `CAN3-${Date.now()}`;
      const a = await mk({ gdrive_mirror_id: M }); const b = await mk({ gdrive_mirror_id: M });
      const p = {};
      const r = await recallDriveMirror(a, p, { clearOnShared: true });
      push('회수/자격상실은 내 포인터만 비운다', r === 'shared' && p.gdrive_mirror_id === null, r);
      await b.reload();
      push('회수/그때도 형제 사본은 남는다', b.gdrive_mirror_id === M, b.gdrive_mirror_id || '(비움)');
    }
    {
      // 마지막 참조: 휴지통 형제의 **죽은 포인터**까지 정리 — 안 하면 복구해도 영영 재미러 안 된다
      const M = `CAN4-${Date.now()}`;
      const dead = await mk({ gdrive_mirror_id: M, deleted_at: new Date() });
      const live = await mk({ gdrive_mirror_id: M });
      await live.update({ deleted_at: new Date() });
      const p = {};
      const r = await recallDriveMirror(live, p);
      await dead.reload({ paranoid: false });
      push('회수/마지막 참조는 사본을 지운다', r === 'removed', r);
      push('회수/휴지통 형제의 죽은 포인터도 정리', !dead.gdrive_mirror_id, dead.gdrive_mirror_id || '(비움)');
    }

    // ── B5. 자격을 되찾으면 다시 올리는가 (Fable 9차 C3) ──────────────
    //   `isEligible` 이 true 로 바뀐 행을 `mirrorOnUpload` 가 실제로 집는가.
    //   ★ C3 는 «저장 전 행을 읽어» 조용히 끝나던 것이었다 — 표에 이 전이가 없어 초록이었다.
    {
      const a = await mk({ gdrive_mirror_id: null, vlevel: 'L1' });
      await a.update({ vlevel: 'L3', visibility: 'L3' });
      const fresh = await db.File.findByPk(a.id);
      const elig = mirror.isEligible(fresh.get({ plain: true }), TOKEN);
      push('자격회복/저장된 행이 미러 대상이 된다', elig, `vlevel=${fresh.vlevel} eligible=${elig}`);
    }

    // ── B6. 폴더를 지울 때 안의 것을 잃지 않는가 (Fable 9차 C1 · 10차 #5#6) ────
    //   ★ 옛 검사는 라우트 **소스 문자열**을 grep 했다 — `continue` 한 줄만 지워도 초록이었다.
    //     지금은 `services/driveFolderCleanup` 에 **가짜 drive** 를 주입해 동작으로 잰다
    //     (실 Drive 호출 0 — 이 검사는 남의 Drive 를 건드리지 않는다).
    {
      const { cleanupDriveFolders } = require('/opt/planq/dev-backend/services/driveFolderCleanup');
      // 트리: root(Rf) ─ sub(Sf) ─ 파일 X.  부모(DEST)로 옮겨야 한다.
      const mkDrive = (tree, trashed = new Set()) => ({
        files: {
          list: async ({ q }) => {
            const m = /'([^']+)' in parents/.exec(q);
            const kids = (tree[m[1]] || []).map((id) => ({ id }));
            return { data: { files: kids } };
          },
          // 목적지 생사 확인용 (Fable 11차 D4)
          get: async ({ fileId }) => ({ data: { id: fileId, trashed: trashed.has(fileId) } }),
        },
      });
      const mkGdrive = (tree, log) => ({
        moveFile: async (_d, id, dest) => {
          for (const k of Object.keys(tree)) tree[k] = tree[k].filter((x) => x !== id);
          tree[dest] = (tree[dest] || []).concat(id);
          log.moved.push(`${id}->${dest}`);
        },
        deleteFile: async (_d, id) => {
          if ((tree[id] || []).length) throw new Error('지우면 안 되는 폴더를 지웠다: ' + id);
          // ★ 실제 Drive 는 지운 항목을 **부모 목록에서도** 뺀다. 안 빼면 가짜가 실물과 달라져
          //   «루트가 안 지워진다» 는 거짓 실패가 난다(2026-09-17 실제로 한 번 났다 —
          //   memory `feedback_positive_control_can_be_wrong`).
          delete tree[id];
          for (const k of Object.keys(tree)) tree[k] = tree[k].filter((x) => x !== id);
          log.deleted.push(id);
        },
        isNotFoundError: () => false,
      });

      // ① 정상: 안의 파일을 부모로 옮기고, 자식 먼저 지우고, 루트도 지워진다
      {
        const tree = { DEST: [], Rf: ['Sf'], Sf: ['X'] };
        const log = { moved: [], deleted: [] };
        const r = await cleanupDriveFolders(mkDrive(tree), mkGdrive(tree, log), ['Sf', 'Rf'], 'DEST');
        push('폴더삭제/안의 파일을 부모로 옮긴다', (tree.DEST || []).includes('X'), `DEST=${JSON.stringify(tree.DEST)} moved=${log.moved.join(',')}`);
        push('폴더삭제/자식·루트 폴더가 모두 지워진다', r.deleted.join(',') === 'Sf,Rf', `deleted=${r.deleted.join(',')}`);
      }
      // ①-b 목적지가 Drive 휴지통이면 **옮기지 않고 남긴다** (Fable 11차 D4)
      {
        const tree = { DEST: [], Rf: ['X'] };
        const log = { moved: [], deleted: [] };
        const r = await cleanupDriveFolders(mkDrive(tree, new Set(['DEST'])), mkGdrive(tree, log), ['Rf'], 'DEST');
        push('폴더삭제/목적지가 휴지통이면 옮기지 않는다', log.moved.length === 0 && r.kept.join(',') === 'Rf',
          `moved=${log.moved.length} kept=${r.kept.join(',')}`);
      }
      // ② 옮길 곳이 없으면(destId=null) **지우지 않고 남긴다** — 잃는 것보다 남기는 편이 낫다
      {
        const tree = { Rf: ['X'] };
        const log = { moved: [], deleted: [] };
        const r = await cleanupDriveFolders(mkDrive(tree), mkGdrive(tree, log), ['Rf'], null);
        push('폴더삭제/옮길 곳이 없으면 폴더를 남긴다', r.deleted.length === 0 && r.kept.join(',') === 'Rf',
          `deleted=${r.deleted.length} kept=${r.kept.join(',')}`);
      }
      // ③ 이동이 실패하면 그 폴더는 **남는다**(안의 항목을 영구삭제하지 않는다) — 음성 대조군
      {
        const tree = { DEST: [], Rf: ['X'] };
        const log = { moved: [], deleted: [] };
        const g = mkGdrive(tree, log);
        g.moveFile = async () => { throw new Error('이동 실패'); };
        const r = await cleanupDriveFolders(mkDrive(tree), g, ['Rf'], 'DEST');
        push('폴더삭제/이동 실패하면 폴더를 남긴다(영구삭제 안 함)', r.deleted.length === 0 && r.kept.join(',') === 'Rf',
          `deleted=${r.deleted.length} kept=${r.kept.join(',')}`);
      }
      // ④ 루트 먼저 넘기면 루트가 안 지워진다 — **순서 계약의 양성 대조군**
      {
        const tree = { DEST: [], Rf: ['Sf'], Sf: [] };
        const log = { moved: [], deleted: [] };
        const r = await cleanupDriveFolders(mkDrive(tree), mkGdrive(tree, log), ['Rf', 'Sf'], 'DEST');
        push('폴더삭제/순서가 뒤집히면 루트가 남는다(대조군)', r.kept.includes('Rf') && r.deleted.includes('Sf'),
          `deleted=${r.deleted.join(',')} kept=${r.kept.join(',')}`);
      }
    }

    // ── B7. 산 참조 술어 — 경로 표기가 달라도 찾는가 (Fable 10차 #2·#3) ─
    //   첨부는 상대경로(`uploads/...`), File 은 절대경로로 저장된다. 완전일치로 물으면
    //   **한 번도 참이 되지 않는다** — 운영 실측 링크 채팅첨부 7건 중 일치 0/7.
    //   그 상태에서는 purge 가 살아 있는 첨부의 바이트를 지운다.
    {
      const fileRefs = require('/opt/planq/dev-backend/services/fileRefs');
      const abs = `${fileRefs.BACKEND_ROOT}/uploads/${BIZ}/canary/ref-${Date.now()}.txt`;
      const rel = abs.slice(fileRefs.BACKEND_ROOT.length + 1);
      push('참조술어/절대·상대 두 표기를 모두 묻는다',
        fileRefs.pathVariants(abs).includes(rel) && fileRefs.pathVariants(rel).includes(abs),
        `abs→${JSON.stringify(fileRefs.pathVariants(abs))}`);

      // 같은 바이트를 가리키는 두 행 — 한쪽은 절대, 한쪽은 상대 표기.
      const A = await mk({ gdrive_mirror_id: null, file_path: abs });
      const B = await mk({ gdrive_mirror_id: null, file_path: rel });
      const refs = await fileRefs.countLiveRefs(A, undefined);
      push('참조술어/표기가 달라도 형제를 찾는다', refs.fileSiblings >= 1,
        `siblings=${refs.fileSiblings} total=${refs.total}`);
      push('참조술어/형제가 있으면 마지막 참조가 아니다',
        (await fileRefs.isLastLiveRef(A, undefined)) === false);
      // 음성 대조군 — 형제를 지우면 마지막 참조가 된다
      await B.destroy({ force: true });
      push('참조술어/형제를 지우면 마지막 참조다(음성 대조군)',
        (await fileRefs.isLastLiveRef(A, undefined)) === true);
    }

    // ── C. Drive 쪽에서 지웠을 때 — 화면이 말하는가 ───────────────────
    {
      const M = `CAN5-${Date.now()}`;
      const a = await mk({ gdrive_mirror_id: M }); const b = await mk({ gdrive_mirror_id: M });
      await gdriveApply.applyChange(BIZ, { fileId: M, removed: true }, null);
      await a.reload(); await b.reload();
      const tag = (f) => f.storage_provider === 'planq' && !f.gdrive_mirror_id && !!f.gdrive_mirrored_at;
      push('Drive삭제/그 미러를 든 모든 행 unmirror', !a.gdrive_mirror_id && !b.gdrive_mirror_id);
      // ★ `mirrored_at` 을 지우면 이 태그가 **영영 false** 가 되어 사용자는 사본이 사라진 것을 모른다.
      push('Drive삭제/«사본 없음» 태그가 뜬다', tag(a) && tag(b), `a=${tag(a)} b=${tag(b)}`);
    }

    // ── D. Drive 변경이 **누구에게** 붙는가 ───────────────────────────
    {
      const M = `CAN6-${Date.now()}`;
      const dead = await mk({ gdrive_mirror_id: M, deleted_at: new Date() });
      const live = await mk({ gdrive_mirror_id: M });
      const found = await gdriveApply.findLocal(BIZ, M);
      push('Drive변경/산 행에 붙는다(휴지통 행 아님)',
        found && String(found.id) === String(live.id), `found=${found && found.id} live=${live.id} dead=${dead.id}`);
    }
  } catch (e) {
    push('카나리 실행', false, e.message);
  } finally {
    if (made.length) {
      try { await db.File.sequelize.query(`DELETE FROM files WHERE id IN (${made.join(',')})`); }
      catch (e) { push('픽스처 정리', false, e.message); }
    }
    // `applyChange` 가 남긴 원장 행 — 검사 기록이 운영 원장에 쌓이지 않게 지운다.
    try {
      await db.File.sequelize.query(
        "DELETE FROM gdrive_sync_logs WHERE gdrive_file_id LIKE 'CAN%' OR gdrive_file_id LIKE 'LC%'",
      );
    } catch (e) { push('원장 정리', false, e.message); }
  }
  return results;
}

module.exports = { run, name: 'drivemirror' };
