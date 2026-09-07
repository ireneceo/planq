// 파일 목록 중복 접기 — 같은 실제 파일이 두 줄로 보이던 것 (2026-09-04)
//
// Irene: "난 채팅에 한번 올렸는데 이렇게 2번 저장이 돼. PDF 채팅 / PDF 직접 업로드"
//
// 두 번 저장된 것이 아니다. 채팅으로 파일을 올리면 **MessageAttachment 와 File 양쪽에
// 행이 생긴다**(파일 시스템에서도 보이게 하려는 의도된 설계). 목록은 direct·chat·task 를
// 합쳐 그리므로 그 파일이 두 줄이 된다.
// 운영 실측: `File id 1359` 와 `MessageAttachment id 36` 의 `file_path` 가 동일
// (`1dAxa83jQOGUN9vZ4rglSCr-LELQ9W9IP`).
//
// 접는 기준은 **실제 파일**(`file_path`)이다. 파일명·크기로 접으면 서로 다른 파일이
// 우연히 같은 이름일 때 하나가 사라진다 — 목록에서 사라지는 것은 삭제와 구별되지 않는다.
//
// 남기는 쪽은 `direct`(File) 다. 공유 링크·공개범위·폴더가 그 행에만 달려 있어
// chat 행을 남기면 그 기능들이 통째로 사라진다. 대신 chat 행이 들고 있던 **대화방 맥락**은
// 남는 행으로 옮겨, 어디서 올라온 파일인지는 그대로 보이게 한다.
const SOURCE_RANK = { direct: 0, chat: 1, task: 2, post: 3, meeting: 4 };

//
// ★ 2026-09-07 — 접는 것과 **분류를 잃는 것**은 다르다.
//   Irene: "파일이 채팅에 있지만 프로젝트 연결된 채팅이면 그냥 프로젝트에만 들어가.
//           채팅에도 나와야지. 이 폴더들은 그냥 태그같은 필터 기능 아니야? 겹쳐서 나와야지."
//   접힌 행의 출처(채팅·업무·문서)가 통째로 사라져서, 좌측 '채팅' 을 눌렀을 때 그 파일이
//   목록에 없었다. 출처는 **배타적 폴더가 아니라 태그**다 → 줄은 하나로 접되
//   `sources` 에 **전부** 남긴다. 화면은 이 배열로 세고 거른다.
function dedupeFileRows(rows) {
  const byPath = new Map();     // file_path → 남길 행
  const out = [];
  const addSource = (row, src) => {
    if (!src) return;
    if (!Array.isArray(row.sources)) row.sources = row.source ? [row.source] : [];
    if (!row.sources.includes(src)) row.sources.push(src);
  };
  for (const r of rows) {
    const key = r && r.file_path_key;
    if (!key) { addSource(r, r && r.source); out.push(r); continue; }   // 경로를 모르면 접지 않는다(잘못 접는 것보다 두 줄이 낫다)
    const kept = byPath.get(key);
    if (!kept) { addSource(r, r.source); byPath.set(key, r); out.push(r); continue; }
    const keptRank = SOURCE_RANK[kept.source] ?? 9;
    const curRank = SOURCE_RANK[r.source] ?? 9;
    // 맥락은 잃지 않는다 — 남는 행에 없고 버리는 행에 있으면 옮긴다
    const winner = curRank < keptRank ? r : kept;
    const loser = winner === r ? kept : r;
    if (!winner.context && loser.context) winner.context = loser.context;
    if (curRank < keptRank) {
      const i = out.indexOf(kept);
      if (i >= 0) out[i] = r;
      byPath.set(key, r);
    }
    // 두 행의 출처를 **남는 행**에 합친다 — 어느 쪽이 이겼든 분류는 둘 다 유효하다.
    addSource(winner, kept.source);
    addSource(winner, r.source);
    // 접힌 행의 맥락도 같이 들고 간다(대화방 이름·업무 제목이 여기 있다).
    if (loser.context) {
      if (!Array.isArray(winner.contexts)) winner.contexts = winner.context ? [winner.context] : [];
      const dup = winner.contexts.some((c) => c && loser.context && c.kind === loser.context.kind && c.id === loser.context.id);
      if (!dup) winner.contexts.push(loser.context);
    }
  }
  return out;
}

module.exports = { dedupeFileRows, SOURCE_RANK };
