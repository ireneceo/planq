// Cue 검색 관련성 관문 회귀 — Fable(2026-09-20)이 잡은 두 계열의 양성 대조군.
//   ①이름이 정확히 맞는 파일이 목록에 남는가(없는 컬럼을 읽어 5건→0건이던 자리)
//   ②「문서 뭐 있어」 폴백이 관문에 죽지 않는가(관문이 hit 을 비우면 폴백도 같이 사라졌다)
//   ③일상어만 있는 질문은 여전히 안 걸리는가(음성 대조군) ④강한 말은 통과하는가
// 실행: cd dev-backend && node scripts/checks/cue-search-gate.js
// Cue 검색 관문 회귀 — Fable 지적 2계열의 양성 대조군
const path = process.env.CUE_CTX || '../../services/cue_context';
const ctx = require(path);
const { getUserScope } = require('../../middleware/access_scope');
const db = require('../../config/database');
const s = db.sequelize || db;

(async () => {
  const [biz] = await s.query("SELECT business_id, user_id FROM business_members WHERE role IN ('owner','admin') LIMIT 1");
  const businessId = biz[0].business_id, userId = biz[0].user_id;
  const [f] = await s.query('SELECT file_name FROM files WHERE business_id=:b AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1', { replacements: { b: businessId } });
  const [pc] = await s.query("SELECT COUNT(*) n FROM posts WHERE business_id=:b AND status<>'draft'", { replacements: { b: businessId } });
  const scope = await getUserScope(userId, businessId);
  const run = async (q) => ctx.getWorkspaceMatches({ businessId, scope, query: q, audience: 'internal', userId });

  let fail = 0;
  const judge = (name, ok, detail) => { console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`); if (!ok) fail++; };

  // ① 이름이 정확히 맞는 파일은 목록에 남는다 (Fable 실측: 5 → 0 이던 자리)
  if (f.length) {
    const token = String(f[0].file_name).replace(/\.[^.]+$/, '').split(/[\s_-]/).filter((x) => x.length >= 4)[0];
    if (token) {
      // ★ 질문에 「파일」 이라는 말을 넣지 않는다 — 넣으면 hints.files 가 켜져 **최근 목록 폴백**이
      //   빈 결과를 채운다. 그러면 관문이 그 파일을 죽여도 "1건" 으로 보여 검사가 거짓 통과한다
      //   (2026-09-20 실측: 결함을 되살렸는데 양성 대조군이 통과했다).
      //   그리고 «몇 건인가» 가 아니라 «그 파일이 들어 있는가» 를 판정한다.
      const m = await run(`${token} 어디 있어`);
      const names = (m?.files || []).map((x) => x.file_name);
      judge('이름 일치 파일이 목록에 남는다', names.includes(f[0].file_name),
        `"${token}" → files [${names.join(', ') || '없음'}]`);
    } else console.log('⬜ 미측정 — 4자 이상 토큰을 가진 파일명이 없다');
  } else console.log('⬜ 미측정 — 파일 0건');

  // ② 「문서 뭐 있어」 폴백이 관문에 죽지 않는다
  if (pc[0].n > 0) {
    const m = await run('문서 뭐 있어');
    judge('문서 폴백이 살아 있다', (m?.posts?.length || 0) >= 1, `posts ${m?.posts?.length || 0}건 (DB ${pc[0].n}건)`);
  } else console.log('⬜ 미측정 — 문서 0건');

  // ③ 음성 대조군 — 관문은 여전히 일상어 오염을 막는다
  const noise = await run('이걸 어떻게 정리해서 요청하면 될지 물었잖아');
  judge('일상어만 있는 질문은 안 걸린다(음성 대조군)', noise === null || (noise.tasks?.length || 0) === 0, `tasks ${noise?.tasks?.length || 0}건`);

  // ④ 강한 말은 여전히 걸린다
  const [t] = await s.query('SELECT title FROM tasks WHERE business_id=:b AND CHAR_LENGTH(title)>=8 ORDER BY updated_at DESC LIMIT 1', { replacements: { b: businessId } });
  if (t.length) {
    const word = String(t[0].title).split(/\s+/).filter((x) => x.length >= 3)[0];
    if (word) {
      const m = await run(`${word} 상태 알려줘`);
      judge('강한 말은 통과한다', (m?.tasks?.length || 0) >= 1, `"${word}" → tasks ${m?.tasks?.length || 0}건`);
    } else console.log('⬜ 미측정 — 3자 이상 토큰 없음');
  } else console.log('⬜ 미측정 — 업무 0건');

  console.log(`\n실패 ${fail}건`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
