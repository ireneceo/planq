// canary-file-source-tags — 출처는 **배타적 폴더가 아니라 태그** (2026-09-07)
//
//   Irene: "파일이 채팅에 있지만 프로젝트 연결된 채팅이면 그냥 프로젝트에만 들어가.
//           채팅에도 나와야지. 이 폴더들은 그냥 태그같은 필터 기능 아니야? 겹쳐서 나와야지."
//
//   같은 실제 파일의 direct/chat/task 행을 한 줄로 접는 것은 맞다(2026-09-04, 두 줄 신고).
//   그런데 접으면서 **버리는 행의 출처를 통째로 잃어서**, 좌측 '채팅' 을 눌렀을 때 그 파일이
//   목록에 없었다. 줄은 하나, 출처는 전부 — 그 계약을 여기서 잰다.
const { dedupeFileRows } = require('/opt/planq/dev-backend/utils/dedupeFileRows');

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });

  // 운영 실측 모양: File id 1359(direct) 와 MessageAttachment id 36(chat) 의 file_path 가 같다.
  const rows = dedupeFileRows([
    { id: 'chat-36', source: 'chat', file_path_key: 'ABC', context: { kind: 'conversation', id: 9, label: '대화방' } },
    { id: 'direct-1359', source: 'direct', file_path_key: 'ABC' },
    { id: 'task-7', source: 'task', file_path_key: 'ABC' },
    { id: 'direct-2', source: 'direct', file_path_key: 'XYZ' },     // 음성 대조군 — 겹칠 상대가 없다
    { id: 'chat-99', source: 'chat', file_path_key: null },          // 경로를 모르면 접지 않는다
  ]);

  const folded = rows.find((r) => r.file_path_key === 'ABC');
  push('같은 파일은 한 줄로 접힌다',
    rows.length === 3 && folded && folded.id === 'direct-1359',
    `${rows.length}줄 · 남은 행 ${folded ? folded.id : '(없음)'} (기대 3줄 · direct-1359 — 공유·폴더가 그 행에만 있다)`);

  const srcs = (folded && folded.sources) || [];
  push('접힌 행의 출처가 전부 남는다 (채팅·업무가 사라지지 않는다)',
    ['direct', 'chat', 'task'].every((s) => srcs.includes(s)),
    `sources=[${srcs.join(', ')}] — 'chat' 이 빠지면 좌측 '채팅' 에서 이 파일이 사라진다`);

  push('대화방 맥락도 같이 남는다',
    !!(folded && folded.context && folded.context.kind === 'conversation'),
    `context=${JSON.stringify(folded && folded.context)}`);

  const lone = rows.find((r) => r.id === 'direct-2');
  push('음성 대조군 — 겹치지 않는 파일에 없는 출처를 붙이지 않는다',
    !!lone && Array.isArray(lone.sources) && lone.sources.length === 1 && lone.sources[0] === 'direct',
    `sources=[${(lone && lone.sources || []).join(', ')}] (기대 [direct] 하나뿐)`);

  return results;
}

module.exports = { run };
