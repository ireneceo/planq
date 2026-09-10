// Google Drive OAuth + API 래퍼
// drive.file scope — 앱이 만든 파일/폴더만 접근
const { google } = require('googleapis');
const cloudTokenCrypto = require('./cloudTokenCrypto');
const { BusinessCloudToken } = require('../models');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

function newOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * OAuth 동의 URL 생성
 * state 에 { businessId, userId, timestamp } + HMAC 서명 → CSRF 방어
 * 유효기간: 10분
 */
const STATE_TTL_MS = 10 * 60 * 1000;

function _hmacState(payloadB64) {
  const crypto = require('crypto');
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

function buildAuthUrl(businessId, userId) {
  const client = newOAuth2Client();
  const payload = Buffer.from(JSON.stringify({ b: businessId, u: userId, t: Date.now() })).toString('base64url');
  const sig = _hmacState(payload);
  const state = `${payload}.${sig}`;
  return client.generateAuthUrl({
    access_type: 'offline',     // refresh_token 받기 위해 필수
    prompt: 'consent',          // refresh_token 매번 받도록 강제 (재연동 시)
    scope: SCOPES,
    state,
    include_granted_scopes: true
  });
}

function parseState(state) {
  try {
    if (typeof state !== 'string' || !state.includes('.')) return null;
    const [payload, sig] = state.split('.', 2);
    // HMAC 검증
    const crypto = require('crypto');
    const expected = _hmacState(payload);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    // 만료 체크
    if (!decoded.t || Date.now() - Number(decoded.t) > STATE_TTL_MS) return null;
    return { businessId: decoded.b, userId: decoded.u, ts: decoded.t };
  } catch {
    return null;
  }
}

/**
 * code → tokens 교환 + 사용자 이메일 조회
 */
async function exchangeCodeForTokens(code) {
  const client = newOAuth2Client();
  const { tokens } = await client.getToken(code);

  // drive.file scope 로 about.get 호출하여 계정 이메일/이름 취득
  // (id_token 에는 email 정보가 없음 — openid scope 가 없으므로)
  let accountEmail = null;
  let accountName = null;
  try {
    client.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: client });
    const about = await drive.about.get({ fields: 'user(emailAddress, displayName)' });
    accountEmail = about.data.user?.emailAddress || null;
    accountName = about.data.user?.displayName || null;
  } catch (e) {
    console.error('[gdrive] about.get failed:', e.message);
  }
  return { tokens, accountEmail, accountName };
}

/**
 * 저장된 토큰으로 Drive 클라이언트 구성
 * 만료 시 자동 갱신 + DB 업데이트
 */
// OAuth2 클라이언트만 따로 — Picker 는 **브라우저에서** access token 을 요구하므로
//   drive 클라이언트가 아니라 auth 자체가 필요하다. 토큰 갱신 저장 로직이 두 벌이 되면
//   한쪽만 갱신을 저장해 다른 쪽이 만료 토큰을 계속 쓴다 → 여기 하나로 둔다.
async function getAuthClient(token) {
  const client = newOAuth2Client();
  // 저장은 암호화. 옛 평문 행은 읽는 순간 암호문으로 재저장된다(지연 백필).
  const { accessToken, refreshToken } = await cloudTokenCrypto.readTokenPair(token);
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: token.expires_at ? new Date(token.expires_at).getTime() : null,
  });
  // 자동 토큰 갱신 감지 → DB 업데이트
  client.on('tokens', async (fresh) => {
    try {
      const update = {};
      if (fresh.access_token) update.access_token = cloudTokenCrypto.writeSecret(fresh.access_token);
      if (fresh.refresh_token) update.refresh_token = cloudTokenCrypto.writeSecret(fresh.refresh_token);
      if (fresh.expiry_date) update.expires_at = new Date(fresh.expiry_date);
      if (Object.keys(update).length > 0) await token.update(update);
    } catch (e) { console.error('[gdrive] token refresh save failed:', e.message); }
  });
  return client;
}

async function getDriveClient(token) {
  return google.drive({ version: 'v3', auth: await getAuthClient(token) });
}

/**
 * PlanQ 루트 폴더 생성 (앱이 만든 파일만 접근하므로, 폴더도 앱이 생성해야 함)
 */
async function createRootFolder(drive, businessName) {
  const res = await drive.files.create({
    requestBody: {
      name: `PlanQ - ${businessName || 'workspace'}`,
      mimeType: 'application/vnd.google-apps.folder'
    },
    fields: 'id, name, webViewLink', supportsAllDrives: true, });
  return res.data;
}

/**
 * 워크스페이스 루트 폴더를 **보장한다** — 저장된 id 가 낡았으면 스스로 고친다.
 *
 * 2026-09-07 실사례: DB 의 root_folder_id·workspace_folder_id 가 **둘 다 404** 였다.
 *   토큰은 멀쩡했고(about.get 정상, files.list 15건) 폴더도 살아 있었는데
 *   **id 만 옛것**이었다(같은 이름의 폴더가 다른 id 로 존재). 화면에는 "연동이 끊겼다" 로 보인다.
 *   Irene: "구글드라이브 자꾸 왜 끊겼다고 해? 제대로 연동해놨던 건데?" — 맞는 말이었다.
 *
 * 순서: ①저장된 id 가 살아 있으면 그대로 ②같은 이름 폴더를 찾아 재사용(가장 오래된 것)
 *       ③그래도 없으면 새로 만든다. ②·③ 이면 토큰을 갱신한다.
 * ★ drive.file scope 라 **앱이 만든 폴더만** 검색된다 — 그래서 ② 가 성립한다.
 */
/**
 * 파일 목록 (첨부 선택용). 워크스페이스(팀) 드라이브와 개인 드라이브가 **같은 구현**을 쓴다 —
 * 인증 클라이언트만 다르다. 베껴 두면 한쪽에만 검색이나 페이지네이션이 남는다.
 * ★ drive.file scope — 앱이 만들었거나 사용자가 앱으로 연 파일만 보인다.
 */
/**
 * 이 파일을 **편집할 수 있게** 사람에게 권한을 준다 (2026-09-07).
 *
 * Irene: *"기본 문서들 편집 가능하게 열기기능 해주고 하기로 했지?"*
 *
 * 왜 권한 부여가 필요한가 — `webViewLink` 는 **연결한 구글 계정 본인에게만** 열린다.
 *   우리는 여태 `permissions.create` 를 한 번도 부른 적이 없어서, 링크를 준 팀원은
 *   "액세스 권한 필요" 만 봤다(2026-09-03 공유 링크가 죽은 것과 같은 원인).
 * ★ `drive.file` scope 로도 **앱이 만든 파일**의 권한은 관리할 수 있다 — 그래서 이게 가능하다.
 * ★ 알림 메일을 보내지 않는다(`sendNotificationEmail: false`). 우리가 부른 적 없는 외부 발송이
 *   사용자 이름으로 나가면 안 된다.
 * ★ 이미 권한이 있으면 아무것도 하지 않는다(멱등) — 부를 때마다 권한 행이 쌓이면 안 된다.
 *
 * @returns {{ granted: boolean, reason?: string }}
 */
async function grantFileAccess(drive, fileId, email, role = 'writer') {
  const addr = String(email || '').trim().toLowerCase();
  if (!addr || !addr.includes('@')) return { granted: false, reason: 'no_email' };
  try {
    const cur = await drive.permissions.list({
      fileId, fields: 'permissions(id, emailAddress, role, type)', supportsAllDrives: true,
    });
    const mine = (cur.data.permissions || []).find(
      (p) => String(p.emailAddress || '').toLowerCase() === addr,
    );
    // 이미 쓰기 이상이면 그대로 둔다. 읽기만 있으면 올려 준다.
    if (mine && (mine.role === 'writer' || mine.role === 'owner' || mine.role === 'organizer')) {
      return { granted: false, reason: 'already' };
    }
    if (mine) {
      await drive.permissions.update({
        fileId, permissionId: mine.id, requestBody: { role }, supportsAllDrives: true,
      });
      return { granted: true, reason: 'upgraded' };
    }
    await drive.permissions.create({
      fileId,
      requestBody: { type: 'user', role, emailAddress: addr },
      sendNotificationEmail: false,
      supportsAllDrives: true,
    });
    return { granted: true, reason: 'created' };
  } catch (e) {
    const msg = String(e.message || '');
    // ★ 구글은 **구글 계정이 없는 주소**에는 권한을 못 준다(2026-09-07 실측):
    //   "You are trying to invite … As there is no Google account associated with this email address…"
    //   PlanQ 계정 이메일이 곧 구글 계정은 아니므로 흔한 경우다. 화면이 사용자 말로 설명해야 한다
    //   — `drive_error:` 로 뭉뚱그리면 "안 열린다" 로만 보인다.
    if (/no Google account/i.test(msg) || /not.*Google account/i.test(msg)) {
      return { granted: false, reason: 'no_google_account' };
    }
    return { granted: false, reason: `drive_error: ${msg.slice(0, 120)}` };
  }
}

async function listDriveFiles(drive, { q, pageSize = 50, pageToken, parentId } = {}) {
  const kw = q ? String(q).trim().slice(0, 100).replace(/'/g, "\\'") : null;
  const clauses = ['trashed=false'];
  if (kw) clauses.push(`name contains '${kw}'`);
  if (parentId) clauses.push(`'${parentId}' in parents`);
  const resp = await drive.files.list({
    q: clauses.join(' and '),
    fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, iconLink, webViewLink)',
    orderBy: 'modifiedTime desc',
    pageSize: Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 100),
    pageToken: pageToken || undefined,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  }, { timeout: 10000 });
  return {
    files: (resp.data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      mime_type: f.mimeType,
      size: f.size ? Number(f.size) : null,
      modified_at: f.modifiedTime,
      icon_link: f.iconLink || null,
      web_view_link: f.webViewLink || null,
    })),
    next_page_token: resp.data.nextPageToken || null,
  };
}

async function ensureRootFolder(drive, token, businessName) {
  // 생성 키와 **같은 이름**을 쓴다. cloud_oauth 는 `biz.name` 으로 만드는데 여기서 brand_name 을
  //   쓰면 서로 다른 폴더를 가리킨다 — Fable 실측: biz5 의 표시명으로 검색하니 **biz3 의 루트**가 잡혔다.
  const name = `PlanQ - ${businessName || 'workspace'}`;

  if (token.root_folder_id) {
    try {
      const r = await drive.files.get({
        fileId: token.root_folder_id, fields: 'id, trashed', supportsAllDrives: true,
      });
      if (r.data && !r.data.trashed) return token.root_folder_id;
    } catch (e) {
      // ★ **404·삭제만 "낡음" 으로 본다.** 500·타임아웃·403(rate limit)에서 복구로 넘어가면
      //   전이 장애 때 고객 Drive 에 두 번째 루트 폴더를 만들고 토큰을 덮어쓴다 —
      //   되돌릴 수 없고, 이후 업로드는 빈 폴더로 간다(Fable 사후 감사 2026-09-07 지적).
      if (!isNotFoundError(e)) throw e;
      // ★ 404 라고 곧 "없는 폴더" 가 아니다. **사용자가 저장 위치로 지정한 폴더**는 우리가 만들지
      //   않아서 `drive.file` 로 읽히지 않는다(실측). 그런데 그 안에 만들고 옮기는 것은 된다.
      //   여기서 되찾기로 넘어가면 멀쩡한 저장 위치를 버리고 새 폴더를 만들어 버린다.
      //   → 읽기 대신 **쓸 수 있는지**로 살아있음을 본다. 읽히기만 하고 못 쓰는 것보다 강한 검사다.
      if (await canWriteInto(drive, token.root_folder_id)) return token.root_folder_id;
    }
  }

  // ── 되찾기 ──
  //  ① 우리가 심어 둔 표식(appProperties)으로 — 이름과 무관하고 워크스페이스마다 고유하다.
  //  ② 없으면 생성 키와 같은 이름으로. 단 **다른 워크스페이스가 이미 쓰는 폴더는 제외**한다.
  const bizId = String(token.business_id);
  let found = null;
  // 검색 실패(권한·네트워크)와 "정말 없음" 을 구별해야 한다 — 구별 못 하면 또 새로 만든다.
  let searched = false;
  try {
    const byMark = await drive.files.list({
      q: `appProperties has { key='planqBusinessId' and value='${escapeDriveQuery(bizId)}' } `
        + `and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name, createdTime)', orderBy: 'createdTime', pageSize: 5,
      supportsAllDrives: true, includeItemsFromAllDrives: true, corpora: 'allDrives',
    });
    found = (byMark.data.files || [])[0] || null;
    searched = true;
  } catch (e) {
    console.warn('[gdrive] 표식 검색 실패:', e.message);
  }

  if (!found) {
    try {
      const byName = await drive.files.list({
        q: `name='${escapeDriveQuery(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name, createdTime)', orderBy: 'createdTime', pageSize: 10,
        supportsAllDrives: true, includeItemsFromAllDrives: true, corpora: 'allDrives',
      });
      const claimed = await claimedRootFolderIds(token.business_id);
      found = (byName.data.files || []).find((f) => !claimed.has(f.id)) || null;
      searched = true;
    } catch (e) {
      console.warn('[gdrive] 이름 검색 실패:', e.message);
      searched = false;
    }
  }

  if (!found) {
    // ★ 검색이 **성공했고 정말 없을 때만** 새로 만든다. 검색이 실패한 상태에서 만들면
    //   멀쩡한 폴더를 두고 두 번째를 만드는 그 사고다.
    if (!searched) throw new Error('drive_root_folder_lookup_failed');
    const created = await createRootFolder(drive, businessName);
    await token.update({ root_folder_id: created.id, last_error: null });
    console.log(`[gdrive] 루트 폴더 신규 생성 → ${created.id} (biz ${bizId})`);
    await stampBusinessMark(drive, created.id, bizId);
    return created.id;
  }

  if (found.id !== token.root_folder_id) {
    await token.update({ root_folder_id: found.id, last_error: null });
    console.log(`[gdrive] 루트 폴더 재연결 → ${found.id} (biz ${bizId})`);
  }
  // 다음부터는 이름이 아니라 표식으로 찾는다(이름이 겹쳐도 안전).
  await stampBusinessMark(drive, found.id, bizId);
  return found.id;
}

/** Drive 검색 문자열 이스케이프 — `\` 를 먼저, 그다음 `'`.
 *  순서를 바꾸면 넣은 백슬래시를 다시 이스케이프해 깨진다. `\` 를 안 막으면 Google 400 이 난다. */
function escapeDriveQuery(v) {
  return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** 이 폴더 안에 만들 수 있는가 — **읽히지 않는 폴더**(사용자가 지정한 것)의 살아있음 판정.
 *  임시 폴더를 만들었다 지운다. 실패하면 정말 못 쓰는 자리다.
 *  ★ 404 경로에서만 부른다(드물다). 매번 부르면 스스로 rate limit 을 올린다.
 *  ★ 이름을 점으로 시작해 사용자 눈에 잘 안 띄게 하고, 성공/실패와 무관하게 지운다. */
async function canWriteInto(drive, folderId) {
  let probeId = null;
  try {
    const r = await drive.files.create({
      requestBody: {
        name: '.planq-write-check', mimeType: 'application/vnd.google-apps.folder',
        parents: [folderId],
      },
      fields: 'id', supportsAllDrives: true,
    });
    probeId = r.data.id;
    return true;
  } catch {
    return false;
  } finally {
    if (probeId) {
      try { await drive.files.delete({ fileId: probeId, supportsAllDrives: true }); }
      catch (e) { console.warn('[gdrive] 쓰기 확인용 임시 폴더 정리 실패:', e.message); }
    }
  }
}

/** 404(또는 파일 없음) 인가 — 그 외 실패를 "낡음" 으로 오해하면 폴더를 남발한다. */
function isNotFoundError(e) {
  const code = e && (e.code || e.status || (e.response && e.response.status));
  if (Number(code) === 404) return true;
  return /File not found/i.test(String((e && e.message) || ''));
}

/** 다른 워크스페이스가 이미 루트로 쓰는 폴더 id 들 — 같은 계정에 여러 워크스페이스가 붙었을 때
 *  이름만 보고 남의 폴더를 채가는 것을 막는다(Fable 실측 사례). */
async function claimedRootFolderIds(exceptBusinessId) {
  try {
    const { BusinessCloudToken } = require('../models');
    const rows = await BusinessCloudToken.findAll({
      where: { provider: 'gdrive' }, attributes: ['business_id', 'root_folder_id'],
    });
    return new Set(rows
      .filter((r) => r.root_folder_id && Number(r.business_id) !== Number(exceptBusinessId))
      .map((r) => r.root_folder_id));
  } catch { return new Set(); }
}

/** 폴더에 "이건 이 워크스페이스 것" 표식을 남긴다. 실패해도 흐름을 막지 않는다(다음 기회에 다시 시도). */
async function stampBusinessMark(drive, fileId, bizId) {
  try {
    await drive.files.update({
      fileId, requestBody: { appProperties: { planqBusinessId: String(bizId) } }, supportsAllDrives: true,
    });
  } catch (e) { console.warn('[gdrive] 표식 기록 실패:', e.message); }
}

/**
 * 하위 폴더 생성 (parent 아래)
 */
async function createFolder(drive, name, parentId) {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined
    },
    fields: 'id, name, webViewLink',
    supportsAllDrives: true,
  });
  return res.data;
}

/**
 * 파일 업로드 (Buffer 또는 stream)
 */
async function uploadFile(drive, { name, mimeType, body, parentId }) {
  const res = await drive.files.create({
    requestBody: {
      name,
      parents: parentId ? [parentId] : undefined
    },
    media: { mimeType, body },
    fields: 'id, name, size, mimeType, webViewLink, webContentLink, createdTime', supportsAllDrives: true, });
  return res.data;
}

/**
 * 파일 삭제
 */
async function deleteFile(drive, fileId) {
  await drive.files.delete({ fileId, supportsAllDrives: true, });
}

/**
 * 사이클 N+16-E — 파일 메타 조회 + 바이트 스트림 가져오기.
 * 채팅 이미지 inline 미리보기용 서버 프록시. drive.file scope 로 PlanQ 가 만든 파일만 접근.
 */
async function getFileMeta(drive, fileId) {
  const r = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size, webViewLink, webContentLink, trashed', supportsAllDrives: true, });
  return r.data;
}

async function getFileStream(drive, fileId) {
  // alt=media → response.data 는 stream
  const r = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true, }, { responseType: 'stream' });
  return r.data;
}

/**
 * 폴더 이름 변경
 */
/**
 * Drive 안에서 파일·폴더를 다른 폴더로 옮긴다 (Irene 2026-08-31).
 *   PlanQ 에서 폴더를 정리했는데 Drive 는 그대로면 두 곳이 갈라진다.
 *   Drive 는 parents 배열이라 **옛 부모를 빼고 새 부모를 더한다**(복사가 아니다).
 */
async function moveFile(drive, fileId, newParentId) {
  const meta = await drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true, });
  const prev = (meta.data.parents || []).join(',');
  await drive.files.update({
    fileId,
    addParents: newParentId,
    ...(prev ? { removeParents: prev } : {}),
    fields: 'id, parents', supportsAllDrives: true, });
  return true;
}

async function renameFile(drive, fileId, name) {
  const res = await drive.files.update({
    fileId,
    requestBody: { name },
    fields: 'id, name', supportsAllDrives: true, });
  return res.data;
}

/**
 * 비즈니스의 저장된 토큰 조회
 */
async function getTokenForBusiness(businessId) {
  return await BusinessCloudToken.findOne({
    where: { business_id: businessId, provider: 'gdrive' }
  });
}

/**
 * 프로젝트용 Drive 폴더 확보 — 없으면 루트 아래에 생성하고 project.gdrive_folder_id 저장
 */
async function ensureProjectFolder(drive, token, project) {
  // 이미 매핑되어 있으면 그대로 (실제 Drive 존재 여부는 신뢰)
  if (project.gdrive_folder_id) {
    try {
      // 폴더 존재 여부 확인
      await drive.files.get({ fileId: project.gdrive_folder_id, fields: 'id, trashed', supportsAllDrives: true, });
      return project.gdrive_folder_id;
    } catch {
      // 외부에서 삭제됨 → 재생성
    }
  }
  const folder = await createFolder(drive, project.name || `Project ${project.id}`, token.root_folder_id);
  project.gdrive_folder_id = folder.id;
  await project.save();
  return folder.id;
}

/**
 * 대화(채팅) 첨부 공용 폴더 확보 — root 아래의 "Conversations" 단일 폴더.
 * 채팅은 conversation 단위 폴더 분리 안 함 (개수 폭발 방지). 파일명에 conv id/제목 prefix 가
 * 필요하면 호출부에서 처리. 폴더 ID 캐시는 token.conversations_folder_id (없으면 컬럼 추가 전까지 매번 lookup).
 */
async function ensureConversationsFolder(drive, token) {
  if (token.conversations_folder_id) {
    try {
      const r = await drive.files.get({ fileId: token.conversations_folder_id, fields: 'id, trashed', supportsAllDrives: true, });
      if (r.data && !r.data.trashed) return token.conversations_folder_id;
    } catch { /* 재생성 */ }
  }
  // 같은 이름 폴더 검색 후 재사용 (컬럼 캐시 없을 때 폴백)
  try {
    const q = `'${token.root_folder_id}' in parents and mimeType='application/vnd.google-apps.folder' and name='Conversations' and trashed=false`;
    const list = await drive.files.list({ q, fields: 'files(id, name)', pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true, });
    if (list.data.files && list.data.files.length > 0) {
      const id = list.data.files[0].id;
      try { await token.update({ conversations_folder_id: id }); } catch { /* 컬럼 없으면 silent */ }
      return id;
    }
  } catch { /* skip — 새로 만들기 */ }
  const folder = await createFolder(drive, 'Conversations', token.root_folder_id);
  try { await token.update({ conversations_folder_id: folder.id }); } catch { /* 컬럼 없으면 silent */ }
  return folder.id;
}

/**
 * Q Note 루트 폴더 확보 — BusinessCloudToken.qnote_folder_id 에 캐시
 * 없으면 root_folder 아래에 "Q Note" 폴더 생성
 */
async function ensureQnoteRootFolder(drive, token) {
  if (token.qnote_folder_id) {
    try {
      const r = await drive.files.get({ fileId: token.qnote_folder_id, fields: 'id, trashed', supportsAllDrives: true, });
      if (r.data && !r.data.trashed) return token.qnote_folder_id;
    } catch { /* 재생성 */ }
  }
  const folder = await createFolder(drive, 'Q Note', token.root_folder_id);
  await token.update({ qnote_folder_id: folder.id });
  return folder.id;
}

/**
 * Q Note 세션별 하위 폴더 확보 (세션명 변경 추적은 별도 — 최초 이름 기준)
 */
async function ensureQnoteSessionFolder(drive, token, { sessionId, sessionTitle, sessionDate }) {
  const qnoteRoot = await ensureQnoteRootFolder(drive, token);
  // 간단 검색: 부모 아래에 같은 이름의 폴더가 있으면 재사용
  const folderName = `${sessionDate ? sessionDate.slice(0, 10) + ' ' : ''}${sessionTitle || `세션 ${sessionId}`}`.slice(0, 150);
  try {
    const q = `'${qnoteRoot}' in parents and mimeType='application/vnd.google-apps.folder' and name='${folderName.replace(/'/g, "\\'")}' and trashed=false`;
    const list = await drive.files.list({ q, fields: 'files(id, name)', pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true, });
    if (list.data.files && list.data.files.length > 0) return list.data.files[0].id;
  } catch { /* 권한/쿼리 실패 시 새로 만들기 */ }
  const folder = await createFolder(drive, folderName, qnoteRoot);
  return folder.id;
}

/**
 * Drive watch 채널 시작 — Google Drive changes.watch
 * 파일 변경 이벤트를 지정된 webhook URL 로 푸시
 */
async function startChangesWatch(drive, { channelId, webhookUrl, tokenHint, expirationMs }) {
  // 먼저 현재 startPageToken 획득
  const startRes = await drive.changes.getStartPageToken();
  const startPageToken = startRes.data.startPageToken;
  const expiration = expirationMs || (Date.now() + 7 * 24 * 60 * 60 * 1000); // 7일 기본
  const watchRes = await drive.changes.watch({
    pageToken: startPageToken,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: webhookUrl,
      token: tokenHint,
      expiration: String(expiration),
    },
  });
  return { channel: watchRes.data, startPageToken };
}

/**
 * watch 채널 중지
 */
async function stopChannel(drive, { channelId, resourceId }) {
  await drive.channels.stop({ requestBody: { id: channelId, resourceId } });
}

/**
 * 변경 목록 조회 (webhook 수신 후 호출)
 */
async function listChanges(drive, pageToken) {
  // #379 — `parents`(이동 감지)·`md5Checksum`(내용 수정 감지)이 없으면 이름변경만 알 수 있다.
  //   Drive 는 요청한 필드만 준다 — 여기 빠지면 적용 엔진이 조용히 아무것도 못 한다.
  const res = await drive.changes.list({
    pageToken,
    fields: 'nextPageToken, newStartPageToken, changes(fileId, removed, time, '
      + 'file(id, name, mimeType, modifiedTime, trashed, parents, md5Checksum, size, webViewLink))', supportsAllDrives: true, includeItemsFromAllDrives: true, });
  return res.data;
}

/**
 * 토큰 오류 박제 / 해제 — invalid_grant(재동의 필요) 감지·표시용.
 * 기록 실패가 본 흐름을 막으면 안 되므로 자체 try/catch.
 */
async function recordTokenError(token, err) {
  try {
    const msg = String((err && err.message) || err || 'unknown').slice(0, 300);
    await token.update({ last_error: msg, last_error_at: new Date() });
  } catch (_) { /* ignore */ }
}

async function clearTokenError(token) {
  try {
    if (token.last_error) await token.update({ last_error: null, last_error_at: null });
  } catch (_) { /* ignore */ }
}

module.exports = {
  isConfigured,
  SCOPES,
  ensureRootFolder,
  listDriveFiles,
  grantFileAccess,
  canWriteInto,
  recordTokenError,
  clearTokenError,
  buildAuthUrl,
  parseState,
  exchangeCodeForTokens,
  getDriveClient,
  getAuthClient,
  createRootFolder,
  createFolder,
  uploadFile,
  deleteFile,
  renameFile,
  moveFile,
  getFileMeta,
  getFileStream,
  getTokenForBusiness,
  ensureProjectFolder,
  ensureConversationsFolder,
  ensureQnoteRootFolder,
  ensureQnoteSessionFolder,
  startChangesWatch,
  stopChannel,
  listChanges
};
