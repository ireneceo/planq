// routes/cloud_oauth.js — 워크스페이스 클라우드 OAuth 콜백 (Google Drive · Google Calendar)
//
// cloud.js 에서 절출했다. 연동 관리(상태·연결 시작·해제·watch·webhook)와 **콜백 처리**는
// 성격이 다르고, 콜백 쪽만 계속 자라 cloud.js 가 라우트 500줄 한도를 넘겼다.
//
// ★ 두 콜백의 공통 규칙 — 새 provider 를 추가할 때도 지킬 것:
//   1. 토큰 교환 직후, **어떤 쓰기보다 먼저** googleScopes.hasRequired() 로 승인 스코프를 검사한다.
//      구글 동의 화면은 항목별 체크박스라, 캘린더/Drive 를 체크 안 해도 code 는 정상 발급된다.
//   2. 거부할 때는 **기존 row 를 일절 건드리지 않고** 리턴한다.
//      재동의 실패가 잘 쓰고 있던 연결을 덮으면 그게 새 사고다.
//   3. scope 는 **콜백에서만** 기록하고 폴백을 두지 않는다.
//      `tokens.scope || 요청목록` 은 승인받지 않은 권한을 승인 기록으로 위조한다.
const express = require('express');
const router = express.Router();
// ★ Business 를 빠뜨리면 **신규 Drive 연결만** 죽는다 — gdrive 콜백이 루트 폴더 이름에 쓴다(아래).
//   재연결(root_folder_id 보유)은 그 블록을 건너뛰어 멀쩡해 보이고, 실패 분기(400)도 멀쩡하다.
//   그래서 스모크로는 안 잡히고, findOrCreate 가 먼저 실행돼 **고아 row 까지 남는다.**
//   절출(2026-08-10) 때 실제로 이 회귀를 냈고 Fable 게이트가 잡았다.
const { BusinessCloudToken, Business } = require('../models');
const gdrive = require('../services/gdrive');
const gcal = require('../services/google_calendar');
const gscopes = require('../services/googleScopes');
const { logOauthFailure } = require('../utils/oauthLog');
const backfill = require('../services/calendarWorkspaceBackfill');   // 재연결 직후 밀린 일정 올리기 (#242)

// 사이클 N+16-B — OAuth 콜백 팝업 자동 닫기 + COOP 차단 시 사용자 친화 안내.
// 옛 버전: 300ms 후 postMessage + 사용자가 직접 "닫기" 클릭 → 일부 브라우저(Chrome/Safari)가
// Cross-Origin-Opener-Policy 로 window.close() 차단 → 닫기 안 됨.
// 새 버전:
//   1) 즉시 postMessage (부모가 상태 갱신)
//   2) 800ms 뒤 자동 window.close() 시도
//   3) 1.5s 후에도 살아있으면 안내 화면 ("이 창을 닫으셔도 됩니다") 로 교체
function buildCallbackHtml({ provider, ok, title, body }) {
  // provider: 'gdrive' | 'gcal' (postMessage type 분기)
  const messageType = provider === 'gcal' ? 'gcal:connected' : 'gdrive:connected';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#F8FAFC;color:#0F172A;}
  .box{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:28px 32px;max-width:420px;text-align:center;box-shadow:0 4px 12px rgba(15,23,42,0.06);}
  h2{margin:0 0 10px;font-size:18px;color:${ok ? '#0F766E' : '#DC2626'};}
  p{margin:0 0 16px;font-size:13px;color:#475569;line-height:1.55;}
  button{height:36px;padding:0 18px;background:#14B8A6;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;}
  button:hover{background:#0D9488;}
  .hint{font-size:11.5px;color:#94A3B8;margin-top:6px;}
  #fallback{display:none;}
</style></head>
<body>
  <div class="box" id="primary">
    ${body}
    <button type="button" id="closeBtn">닫기</button>
    <div class="hint">잠시 후 자동으로 닫힙니다…</div>
  </div>
  <div class="box" id="fallback">
    <h2 style="color:#0F766E;">✓ 완료</h2>
    <p>이 창을 닫으셔도 됩니다.<br/>브라우저 보안 정책으로 자동 닫기가 막힌 환경입니다.</p>
  </div>
  <script>
    (function(){
      var TYPE = ${JSON.stringify(messageType)};
      var OK = ${ok ? 'true' : 'false'};
      // #224 — 팝업이 accounts.google.com 을 경유하면서 COOP 로 **opener 가 끊긴다.**
      //   그 결과 (a) postMessage 가 조용히 실패하고 (b) 자기 window.close() 도 거부돼
      //   "완료 화면에서 창이 영영 안 닫히는" 회귀가 났다(사용자 보고).
      //   opener 에 의존하지 않는 동일 출처 채널(BroadcastChannel + localStorage)로 완료를 알리고,
      //   **팝업 핸들을 쥐고 있는 부모가 대신 닫게** 한다. 자기 close 는 되면 좋은 보조 경로로만 둔다.
      var payload = { type: TYPE, ok: OK, ts: Date.now() };
      try { var bc = new BroadcastChannel('planq:oauth'); bc.postMessage(payload); bc.close(); } catch(e){}
      try { localStorage.setItem('planq:oauth:done', JSON.stringify(payload)); } catch(e){}
      try { window.opener && window.opener.postMessage(payload, '*'); } catch(e){}

      var tryClose = function(){ try { window.close(); } catch(e){} };
      document.getElementById('closeBtn').addEventListener('click', tryClose);
      setTimeout(tryClose, 600);
      // 그래도 살아있으면(=COOP 로 close 거부) 안내 화면으로 교체. 부모의 close 가 이 사이에 먼저 성공하면 이 코드는 실행되지 않는다.
      setTimeout(function(){
        var p = document.getElementById('primary');
        var f = document.getElementById('fallback');
        if (p && f) { p.style.display = 'none'; f.style.display = 'block'; }
      }, 1500);
    })();
  </script>
</body></html>`;
}

// ─── OAuth 콜백 ───
// Google 이 이 엔드포인트로 리디렉트. state 로 사용자 복원.
router.get('/callback/gdrive', async (req, res) => {
  const { code, state, error: oauthError } = req.query;
  const ok = (title, body) => buildCallbackHtml({ provider: 'gdrive', ok: !title.includes('실패'), title, body });

  if (oauthError) {
    logOauthFailure('gdrive callback', 'oauth_denied', { error: oauthError });
    return res.status(400).send(ok('연동 실패', `<h2>연동 실패</h2><p>Google 에서 거부됨: ${oauthError}</p>`));
  }
  if (!code || !state) {
    logOauthFailure('gdrive callback', 'missing_code_or_state');
    return res.status(400).send(ok('연동 실패', '<h2>연동 실패</h2><p>잘못된 요청</p>'));
  }

  const parsed = gdrive.parseState(state);
  if (!parsed) {
    logOauthFailure('gdrive callback', 'bad_state');
    return res.status(400).send(ok('연동 실패', '<h2>연동 실패</h2><p>state 검증 실패</p>'));
  }

  try {
    // 토큰 교환
    const { tokens, accountEmail } = await gdrive.exchangeCodeForTokens(code);

    // ── 승인 스코프 가드 (2026-08-10) — gcal 콜백과 같은 규칙 ────────────────────
    // 여기엔 여태 검사가 없었다. Drive 항목을 체크 안 하고 돌아오면:
    //   · 신규 연결 → 아래 findOrCreate 가 먼저 row 를 만들고 폴더 생성에서 throw →
    //     화면엔 "연동 실패" 인데 **깨진 row 는 DB 에 남는다**(고아)
    //   · 재연결   → root_folder_id 가 이미 있어 폴더 블록을 건너뛰고 **"연동 완료" 로 조용히 성공**
    //     → 2026-07-27 캘린더 사고와 똑같은 형태가 Drive 에서 재현된다
    // ★ findOrCreate **이전에**, 기존 row 를 건드리지 않고 리턴한다.
    if (!gscopes.hasRequired('gdrive', tokens.scope)) {
      logOauthFailure('gdrive callback', 'scope_missing_required', {
        businessId: parsed.businessId, userId: parsed.userId, scope: tokens.scope || '(none)',
      });
      return res.status(400).send(buildCallbackHtml({
        provider: 'gdrive', ok: false, title: '연동 실패',
        body: '<h2>Drive 권한이 필요합니다</h2><p>Google 동의 화면에서 <strong>"Google Drive에서 이 앱으로 열거나 만든 파일 보기 및 관리"</strong> 항목이 체크되지 않았습니다.<br/>다시 연결하면서 해당 항목을 <strong>체크</strong>해 주세요.</p>',
      }));
    }

    // 기존 연동 있으면 업데이트, 없으면 생성
    const [record] = await BusinessCloudToken.findOrCreate({
      where: { business_id: parsed.businessId, provider: 'gdrive' },
      defaults: {
        business_id: parsed.businessId,
        provider: 'gdrive',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scope: tokens.scope,
        account_email: accountEmail,
        connected_by: parsed.userId,
        connected_at: new Date()
      }
    });
    // 기존 레코드면 갱신
    record.access_token = tokens.access_token;
    if (tokens.refresh_token) record.refresh_token = tokens.refresh_token;
    record.expires_at = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
    // ★ 폴백 금지 — `|| record.scope` 는 이번 동의에서 승인받지 못한 옛 값을 남겨,
    //   권한이 빠진 재연결을 "여전히 권한 있음" 으로 보이게 했다. 위 가드를 통과했으므로
    //   tokens.scope 는 반드시 존재한다.
    record.scope = tokens.scope;
    record.account_email = accountEmail || record.account_email;
    record.connected_by = parsed.userId;
    record.connected_at = new Date();

    // 루트 폴더 확보 (없으면)
    // 사이클 N+19 hotfix — disconnect→reconnect 시 Drive 에 옛 "PlanQ - {bizName}" 폴더가
    // 남아 있으면 그것을 재사용. drive.file scope 라 PlanQ 가 직접 만든 폴더만 검색 가능.
    // 같은 이름 폴더 2개 이상이면 createdTime ASC 첫 번째 (가장 오래된 — 진짜 옛 폴더).
    if (!record.root_folder_id) {
      const biz = await Business.findByPk(parsed.businessId);
      const bizName = biz ? biz.name : 'workspace';
      const targetName = `PlanQ - ${bizName}`;
      const drive = await gdrive.getDriveClient(record);
      let folderId = null;
      try {
        const list = await drive.files.list({
          q: `name='${targetName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: 'files(id, name, createdTime)',
          orderBy: 'createdTime',
          pageSize: 1,
        });
        if (list.data.files && list.data.files.length > 0) {
          folderId = list.data.files[0].id;
          console.log('[gdrive callback] reusing existing root folder for biz=' + parsed.businessId + ' folder=' + folderId);
        }
      } catch (e) {
        console.warn('[gdrive callback] root folder search failed:', e.message);
      }
      if (!folderId) {
        const root = await gdrive.createRootFolder(drive, bizName);
        folderId = root.id;
      }
      record.root_folder_id = folderId;
    }
    await record.save();

    return res.send(buildCallbackHtml({
      provider: 'gdrive', ok: true, title: '연동 완료',
      body: `<h2>Google Drive 연동 완료</h2><p>계정: <strong>${accountEmail || '(확인 불가)'}</strong><br/>루트 폴더 생성됨.</p>`,
    }));
  } catch (e) {
    console.error('[gdrive callback]', e);
    return res.status(500).send(buildCallbackHtml({
      provider: 'gdrive', ok: false, title: '연동 실패',
      body: `<h2>연동 실패</h2><p>${e.message || '서버 오류'}</p>`,
    }));
  }
});

router.get('/callback/gcal', async (req, res) => {
  const { code, state, error: oauthError } = req.query;
  const ok = (title, body) => buildCallbackHtml({ provider: 'gcal', ok: !title.includes('실패'), title, body });

  if (oauthError) {
    logOauthFailure('gcal callback', 'oauth_denied', { error: oauthError });
    return res.status(400).send(ok('연동 실패', `<h2>연동 실패</h2><p>Google 에서 거부됨: ${oauthError}</p>`));
  }
  if (!code || !state) {
    logOauthFailure('gcal callback', 'missing_code_or_state');
    return res.status(400).send(ok('연동 실패', '<h2>연동 실패</h2><p>잘못된 요청</p>'));
  }
  const parsed = gcal.parseState(state);
  if (!parsed) {
    logOauthFailure('gcal callback', 'bad_state');
    return res.status(400).send(ok('연동 실패', '<h2>연동 실패</h2><p>state 검증 실패</p>'));
  }

  try {
    const { tokens, accountEmail } = await gcal.exchangeCodeForTokens(code);

    // 동의 화면에서 캘린더 항목 체크박스를 해제한 채 승인해도 code 는 정상 발급된다.
    // 이때 저장해 버리면 "연동 완료" 로 보이지만 이후 모든 push 가 403 으로 죽는다
    // (2026-07-27 운영 사고). 쓰기 권한 없는 토큰은 저장하지 않고 재연결을 요구한다.
    if (!gcal.hasWriteScope(tokens.scope)) {
      logOauthFailure('gcal callback', 'scope_missing_write', {
        businessId: parsed.businessId, userId: parsed.userId, scope: tokens.scope || '(none)',
      });
      return res.status(400).send(buildCallbackHtml({
        provider: 'gcal', ok: false, title: '연동 실패',
        body: '<h2>캘린더 권한이 필요합니다</h2><p>Google 동의 화면에서 <strong>"Google 캘린더의 캘린더를 사용하여 이벤트 보기 및 수정"</strong> 항목이 체크되지 않았습니다.<br/>다시 연결하면서 해당 항목을 <strong>체크</strong>해 주세요.</p>',
      }));
    }

    const [record] = await BusinessCloudToken.findOrCreate({
      where: { business_id: parsed.businessId, provider: 'gcal' },
      defaults: {
        business_id: parsed.businessId,
        provider: 'gcal',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scope: tokens.scope,
        account_email: accountEmail,
        connected_by: parsed.userId,
        connected_at: new Date(),
      },
    });
    record.access_token = tokens.access_token;
    if (tokens.refresh_token) record.refresh_token = tokens.refresh_token;
    record.expires_at = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
    // ★ 폴백 금지 — gdrive 와 같은 규칙. 위 hasWriteScope 가드를 통과했으므로 tokens.scope 는
    //   반드시 존재한다(현재는 사실상 죽은 폴백이지만, 옛 값을 남기는 코드를 옆에 두면
    //   다음 사람이 그것을 정상 패턴으로 읽는다).
    record.scope = tokens.scope;
    record.account_email = accountEmail || record.account_email;
    record.connected_by = parsed.userId;
    record.connected_at = new Date();
    record.last_error = null;          // 재연결 성공 — 옛 오류 배지 해제
    record.last_error_at = null;
    await record.save();

    // ★ 재연결 직후 **밀린 일정을 팀 캘린더로 올린다** (#242, 설계 게이트 치명-5).
    //   권한이 죽어 있던 기간의 일정은 목적지 목록에서 제외돼 **워크스페이스 링크가 아예 없다** —
    //   재연결만 하고 두면 사용자가 구글을 열었을 때 비어 있고 "역시 안 되네" 로 끝난다.
    //   ★ 여기(콜백)에서 돌린다 — 캘린더 배너로 재연결하든 설정 화면으로 하든 **모든 경로가 지난다**.
    //     응답을 먼저 보내고 뒤에서 돌린다(구글 API 호출이라 팝업을 붙잡아 두면 안 된다).
    //   broadcast 는 백필 서비스가 한다 — 다른 멤버 화면의 "끊김" 배너를 내리는 유일한 신호다.
    const io = req.app.get('io');
    setImmediate(() => {
      backfill.backfillWorkspace(parsed.businessId, parsed.userId, { io })
        .catch((e) => console.error('[gcal callback] 백필 실패:', e.message));
    });

    return res.send(buildCallbackHtml({
      provider: 'gcal', ok: true, title: '연동 완료',
      body: `<h2>Google Calendar 연동 완료</h2><p>계정: <strong>${accountEmail || '(확인 불가)'}</strong><br/>화상회의 시 Google Meet 링크가 자동으로 만들어집니다.<br/>연결이 끊겼던 동안의 일정을 팀 캘린더로 올리는 중입니다.</p>`,
    }));
  } catch (e) {
    console.error('[gcal callback]', e);
    return res.status(500).send(buildCallbackHtml({
      provider: 'gcal', ok: false, title: '연동 실패',
      body: `<h2>연동 실패</h2><p>${e.message || '서버 오류'}</p>`,
    }));
  }
});

module.exports = router;
