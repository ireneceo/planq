// services/emailImapCron.js — Q Mail M1 IMAP fetch cron (5분 주기)
//
// 작동 흐름 (CLAUDE.md §16 실시간 동기화 정합):
//   1. 활성 email_accounts 조회 (last_sync_at 오래된 순)
//   2. 각 account sequential (병렬 X — IMAP server rate-limit 회피)
//      a. imap-simple connect (TLS, 30s timeout)
//      b. UID > last_uid 메시지 fetch (limit 50)
//      c. 각 메시지 parse + thread 매칭 + client 매칭 + attachment 자동 File 저장
//      d. socket emit 'mail:new' to business room
//      e. AI 백그라운드 (M5/M6 후속)
//   3. 에러 시 fail_count++ + last_sync_error
//   4. fail_count ≥ 3 → platform_admin alert (notify)
const cron = require('node-cron');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const { Op } = require('sequelize');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { decrypt } = require('./encryption');
const { needsReauth } = require('./emailAccountHealth');
const { isEmbedded, isNoiseAttachment } = require('./emailAttachments');
const { reservePlanqUpload } = require('./storageUsage');
const { toNFC } = require('./filename');   // #364 — 첨부 파일명 조합형 통일 (업로드 관문과 같은 축)
const {
  EmailAccount, EmailThread, EmailMessage, EmailAttachment, EmailThreadParticipant,
  Client, File: FileModel, Business,
} = require('../models');


// 삭제된 워크스페이스의 메일 계정은 폴링·IDLE 대상에서 뺀다.
// 안 거르면 워크스페이스를 지워도 IMAP 연결이 유지되고 메일이 계속 수집된다.
// (개인 계정은 business_id 가 없을 수 있어 그 경우는 통과)
async function liveBusinessIdSet() {
  try {
    const { Business } = require('../models');
    const rows = await Business.findAll({ attributes: ['id'], where: { deleted_at: null }, raw: true });
    return new Set(rows.map((b) => b.id));
  } catch { return null; }
}
const FETCH_LIMIT_PER_ACCOUNT = 50;
// 계정을 처음 연결하면 최근 N일 메일을 가져온다 (Irene 결정 2026-07-12).
//   여태는 "연결 이후 새로 오는 메일만" 가져와서, 방금 연결한 사용자는 빈 화면을 봤다.
//   "연결됐습니다" 라고 해놓고 아무것도 안 보이면 고장난 것으로 보인다.
//   과거 메일은 읽기만 — 다른 데서 이미 처리했을 가능성이 높아 "답변 필요" 로 올리지 않는다
//   (수백 건이 한꺼번에 답변 필요로 들어오면 그 폴더가 무용지물이 된다).
const BACKFILL_DAYS = 30;
const BACKFILL_LIMIT = 300;   // 첫 동기화가 몇 분씩 걸리지 않게 상한
const FAIL_ALERT_THRESHOLD = 3;
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

// Subject 정규화 (Re:/Fwd: 제거)
function normalizeSubject(s) {
  return String(s || '').replace(/^\s*(re|fwd|fw)\s*:\s*/i, '').replace(/^\s*(re|fwd|fw)\s*:\s*/i, '').trim();
}

// thread 매칭 — In-Reply-To / References / Subject+참여자
async function findOrCreateThread({ businessId, accountId, parsed, fromEmail }) {
  // 1. In-Reply-To → 기존 message_id
  if (parsed.inReplyTo) {
    const existingMsg = await EmailMessage.findOne({
      where: { business_id: businessId, message_id: parsed.inReplyTo },
      attributes: ['thread_id'],
    });
    if (existingMsg) {
      const t = await EmailThread.findByPk(existingMsg.thread_id);
      if (t) return { thread: t, isNew: false };
    }
  }
  // 2. References 헤더의 마지막 message-id
  const refs = parsed.references || [];
  if (Array.isArray(refs) && refs.length > 0) {
    const last = refs[refs.length - 1];
    const existingMsg = await EmailMessage.findOne({
      where: { business_id: businessId, message_id: last },
      attributes: ['thread_id'],
    });
    if (existingMsg) {
      const t = await EmailThread.findByPk(existingMsg.thread_id);
      if (t) return { thread: t, isNew: false };
    }
  }
  // 3. Subject + 같은 from email — 최근 30일 기존 thread
  const normSubj = normalizeSubject(parsed.subject);
  if (normSubj) {
    const since = new Date(Date.now() - 30 * 86400 * 1000);
    const candidates = await EmailThread.findAll({
      where: {
        business_id: businessId,
        account_id: accountId,
        subject: normSubj,
        last_message_at: { [Op.gte]: since },
      },
      // #200(b') — 후보를 무순서로 뽑으면 동일 제목 스레드가 여러 개일 때(운영 89 그룹)
      //   어디에 붙을지 PK 임의 순서로 정해진다. 참여자 백필이 이 경로를 실제로 켜므로
      //   "가장 최근에 오간 스레드" 로 착지점을 고정한다.
      order: [['last_message_at', 'DESC']],
      limit: 5,
    });
    for (const cand of candidates) {
      const parts = Array.isArray(cand.participants) ? cand.participants : [];
      if (parts.some(p => p.email && p.email.toLowerCase() === fromEmail.toLowerCase())) {
        return { thread: cand, isNew: false };
      }
    }
  }
  // 4. 신규
  const newThread = await EmailThread.create({
    business_id: businessId,
    account_id: accountId,
    subject: normSubj || parsed.subject || '(no subject)',
    status: 'open',
    vlevel: 'L3',
    participants: [],
    message_count: 0,
    unread_count: 0,
  });
  return { thread: newThread, isNew: true };
}

// client 매칭 — invite_email / billing_contact_email exact or aliases JSON contains
async function matchClient(businessId, fromEmail) {
  const { Op } = require('sequelize');
  const exact = await Client.findOne({
    where: {
      business_id: businessId,
      [Op.or]: [
        { invite_email: fromEmail },
        { billing_contact_email: fromEmail },
      ],
    },
    attributes: ['id'],
  });
  if (exact) return exact.id;
  // aliases — JSON_SEARCH. client 매칭은 부가 정보 — 어떤 실패도 메시지 저장을 막으면 안 됨
  try {
    const { sequelize } = require('../config/database');
    const [rows] = await sequelize.query(
      `SELECT id FROM clients WHERE business_id = ? AND JSON_SEARCH(email_aliases, 'one', ?) IS NOT NULL LIMIT 1`,
      { replacements: [businessId, fromEmail] }
    );
    return rows[0] ? rows[0].id : null;
  } catch (e) {
    console.warn('[emailImapCron] client alias match skipped:', e.message);
    return null;
  }
}

// attachment File 자동 저장 (visibility=L3, folder 'Email Attachments')

// "아는 상대" 판정 — 답변 필요의 가장 강한 신호 (Irene: "고객이 보낸 거, 기존 일과 연결되는 내용").
//   ① 고객(Client) 이메일  ② 워크스페이스 멤버  ③ 우리가 전에 답장을 보낸 적 있는 주소
//   LLM 0 — 관계 데이터만 본다.
async function isKnownContact(businessId, fromEmail) {
  const addr = String(fromEmail || '').toLowerCase().trim();
  if (!businessId || !addr) return false;
  try {
    const client = await matchClient(businessId, addr);
    if (client) return true;

    const { User, BusinessMember } = require('../models');
    const { sequelize } = require('../config/database');
    const member = await BusinessMember.findOne({
      where: { business_id: businessId, removed_at: null },
      include: [{ model: User, as: 'user', attributes: ['id'], where: { email: addr }, required: true }],
      attributes: ['id'],
    });
    if (member) return true;

    // 우리가 전에 이 주소로 답장을 보낸 적 있는가 (= 이미 진행 중인 대화)
    //   to_emails 는 JSON 컬럼 — Sequelize fn('JSON_SEARCH', ...) 은 '$' 를 '$$' 로 이스케이프해
    //   쿼리가 항상 실패한다(청구서 카드 실사고와 같은 함정) → literal 로 직접 작성. addr 은 이스케이프.
    const safe = addr.replace(/'/g, "''");
    const [rows] = await sequelize.query(
      `SELECT id FROM email_messages
        WHERE business_id = :biz AND direction = 'outbound'
          AND JSON_SEARCH(to_emails, 'one', '${safe}') IS NOT NULL
        LIMIT 1`,
      { replacements: { biz: businessId } }
    );
    return rows.length > 0;
  } catch (e) {
    console.warn('[isKnownContact]', e.message);
    return false;   // 판정 실패 시 보수적으로 '모르는 상대' — 확인 권장으로 가지 답변 필요로 오분류하지 않는다
  }
}


// 첨부를 PlanQ File 로 저장. 반환 = file.id (저장 안 함이면 null).
//
// #215-F — **개인 메일 계정의 첨부는 L1(본인만)** 이다.
//   `email_accounts.owner_user_id` 가 set 이면 개인 계정(모델 주석: "NULL = 회사 공용, set = 개인").
//   스레드·메시지는 이미 accessibleAccountIds() 가 이 축으로 격리하는데 **파일만 L3 로 새고 있었다** —
//   개인 메일함 첨부가 워크스페이스 전 멤버의 Q File 에 노출되던 반쪽 상태.
//   권위 컬럼 `vlevel` 을 legacy `visibility` 와 **동시에** 쓴다 (한쪽만 쓰면 같은 누출이 재발한다).
// #215-F 결합 — uploader_id 는 계정 주인이어야 한다.
//   여태 무조건 workspace owner_id 였는데, canAccessFileByLevel 의 L1 은 `uploader_id === userId` 만 통과시킨다.
//   uploader 교정 없이 L1 만 주면 **개인 계정 주인이 자기 첨부에서 차단되는** 2차 사고가 난다.
// #215-G — 기계 파트(반송 헤더·AMP 본문)는 File 을 아예 만들지 않는다. 스토리지 쿼터·Q File 오염 차단.
// ── #370 저장 게이트 ──
//   워프로랩 Q File 의 52%(524건·20.5MB)가 planq-logo.png 였다. 우리 알림메일의 인라인 로고가
//   첨부로 들어와 **매번 물리 파일 + File row** 로 저장된 결과다(하루 ~15건, 전부 39,196B 동일 바이트).
//
//   ★ 표시 술어(emailAttachments.isEmbedded)는 **손대지 않는다.** 그건 #215 가 "본문이 참조하지 않으면
//     보여준다" 는 fail-open 으로 둔 것이고, 세금계산서 같은 진짜 첨부가 숨는 사고를 막는 장치다.
//     저장 여부는 그것과 축이 다르다 — 여기 저장 단계에 게이트를 따로 둔다.
//   ★ 수신 서버가 cid: 를 data:base64 로 치환해 배달하기 때문에 "본문이 cid 를 참조하는가" 로는
//     로고를 못 잡는다(실측: inbound 2,274건 중 cid 참조 9건 vs data:image 684건). 그래서
//     **첨부 자신의 contentId** 로 본다 — 치환돼도 첨부의 cid 는 그대로 남는다.
const PLATFORM_LOGO_CID = 'planq-logo@platform';
function isPlatformLogo(att) {
  const cid = String(att?.contentId || att?.cid || '').replace(/[<>]/g, '').toLowerCase();
  if (cid === PLATFORM_LOGO_CID) return true;
  // cid 가 유실된 경우의 보조 판정 — 이름·타입·크기가 전부 맞을 때만(오탐 방지).
  const name = String(att?.filename || '').toLowerCase();
  const size = att?.size || (att?.content ? att.content.length : 0);
  return name === 'planq-logo.png' && String(att?.contentType || '').startsWith('image/') && size < 200 * 1024;
}

async function saveAttachmentAsFile({ businessId, att, account, fallbackOwnerId }) {
  try {
    if (isNoiseAttachment(att.contentType)) return null;
    // 플랫폼 로고는 사용자의 자료가 아니다 — 파일 목록에 쌓이면 진짜 자료를 덮는다.
    if (isPlatformLogo(att)) return null;
    const personal = !!(account && account.owner_user_id);
    const level = personal ? 'L1' : 'L3';
    const ym = new Date().toISOString().slice(0, 7);
    const dir = path.join(UPLOAD_ROOT, String(businessId), 'email', ym);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(att.filename || '') || '';
    const uuid = crypto.randomBytes(16).toString('hex');
    const fname = `${uuid}${ext}`;
    const fpath = path.join(dir, fname);
    const bytes = att.size || att.content.length;
    // #372 — 메일첨부가 스토리지 카운터를 아예 안 올리고 있었다(집계 14건/53MB vs 실제 961건/183MB).
    //   카운터가 실제와 벌어지면 쿼터가 아무것도 못 막는다. force=true — 이미 도착한 메일이라
    //   한도를 넘겨도 거절할 수 없다(거절하면 사용자에게 온 자료가 사라진다). 세는 것이 목적이다.
    //   ⚠ storageUsage 는 자체 트랜잭션을 연다 — 여기는 트랜잭션 밖이라 안전하다.
    try { await reservePlanqUpload(businessId, bytes, { force: true }); }
    catch (e) { console.warn('[emailImapCron] storage usage 집계 실패:', e.message); }
    fs.writeFileSync(fpath, att.content);
    const file = await FileModel.create({
      business_id: businessId,
      uploader_id: (personal ? account.owner_user_id : null) || fallbackOwnerId || null,
      // #364 — 메일 첨부는 업로드 관문(services/filename decodeOriginalName)을 안 지난다.
      //   맥에서 보낸 한글 첨부는 분해형(NFD)이라 그대로 넣으면 검색이 조용히 실패한다
      //   (사용자가 "스크린샷" 을 쳐도 0건). 여기서도 조합형으로 통일한다.
      file_name: toNFC(att.filename || `attachment${ext}`),
      file_path: fpath,
      file_size: bytes,
      mime_type: att.contentType || 'application/octet-stream',
      storage_provider: 'planq',
      project_id: null,
      visibility: level,
      vlevel: level,
    });
    return file.id;
  } catch (e) {
    console.error('[emailImapCron] attachment save failed:', e.message);
    return null;
  }
}

// account 1개 sync — N+70 auth_type 분기 (password / google_oauth)
// IMAP 연결 설정 빌드 — syncOne(폴링) 과 IDLE 매니저(지속연결) 공용.
//   OAuth 는 access_token 만료 시 refresh 후 DB 갱신. onIdle=true 면 node-imap keepalive 로 IDLE 유지.
async function buildImapConfig(account, { onIdle = false } = {}) {
  let imapConfig;
  if (account.auth_type === 'google_oauth') {
    const gmailOauth = require('./gmail_oauth');
    let accessToken = decrypt(account.oauth_access_token_encrypted);
    const expiresAt = account.oauth_expires_at ? new Date(account.oauth_expires_at).getTime() : 0;
    const now = Date.now();
    if (!accessToken || (expiresAt && now > expiresAt - 60000)) {
      const refreshToken = decrypt(account.oauth_refresh_token_encrypted);
      if (!refreshToken) throw new Error('oauth_refresh_token_missing');
      const refreshed = await gmailOauth.refreshAccessToken(refreshToken);
      accessToken = refreshed.access_token;
      await account.update({
        oauth_access_token_encrypted: require('./encryption').encrypt(accessToken),
        oauth_expires_at: refreshed.expires_at,
      });
    }
    imapConfig = {
      user: account.imap_username,
      xoauth2: gmailOauth.buildXOAuth2(account.imap_username, accessToken),
      host: account.imap_host,
      port: account.imap_port,
      tls: account.imap_tls,
      authTimeout: 30000,
      tlsOptions: { rejectUnauthorized: false },
    };
  } else {
    const password = decrypt(account.imap_password_encrypted);
    if (!password) throw new Error('password_decrypt_failed');
    imapConfig = {
      user: account.imap_username,
      password,
      host: account.imap_host,
      port: account.imap_port,
      tls: account.imap_tls,
      authTimeout: 30000,
      tlsOptions: { rejectUnauthorized: false },
    };
  }
  // node-imap keepalive: idle 상태에서 주기적으로 NOOP/IDLE 갱신 → 새 메일 즉시 'mail' 이벤트.
  if (onIdle) imapConfig.keepalive = { interval: 10000, idleInterval: 300000, forceNoop: true };
  return imapConfig;
}

async function syncOne(account, opts = {}) {
  const imapConfig = await buildImapConfig(account);

  const conn = await imaps.connect({ imap: imapConfig });

  // "우리 주소" 집합 — 우리가 보낸 메일(플랫폼 알림·워크스페이스 발송)이 되돌아온 것은
  // 사람 문의가 아니다. 이게 없어서 운영 "답변 필요" 116건 중 93건이 자기 알림이었다.
  const { buildOwnEmailSet, buildOwnAddressMatcher } = require('./emailTriage');
  const ownEmails = await buildOwnEmailSet(account.business_id);
  // 수신 인식 전용 매처 — 정확 주소 + 워크스페이스 도메인 규칙.
  //   ownEmails 는 발신 축(자기발신·자동발송 판정)에 그대로 쓰인다. 두 축을 섞지 않는다.
  const ownMatcher = await buildOwnAddressMatcher(account.business_id);

  // 참여자 제외 집합 — 이 계정 주소 + 별칭. 동기화 1회당 한 번만 조회한다.
  //   ownEmails(비즈니스 전체)와 다르다: 같은 워크스페이스의 다른 계정끼리 주고받은 메일에서
  //   상대 계정은 정당한 참여자다 (#200 b').
  const { mergeParticipants, selfEmailsForAccount } = require('./emailAddress');
  const selfEmails = await selfEmailsForAccount(account);

  let newCount = 0;
  try {
    const box = await conn.openBox(account.imap_folder);

    // 첫 동기화(또는 명시적 백필 요청) — 최근 BACKFILL_DAYS 일 메일을 가져온다.
    //   isBackfill 인 동안 받은 메일은 reply_needed 를 켜지 않는다(과거분은 읽기만).
    const isBackfill = opts.backfill === true || account.imap_last_uid === 0;
    let searchCriteria;
    let fetchCap;
    if (isBackfill) {
      const since = new Date(Date.now() - (opts.days || BACKFILL_DAYS) * 86400000);
      // IMAP SINCE 는 날짜 단위 (DD-Mon-YYYY)
      searchCriteria = [['SINCE', since]];
      fetchCap = BACKFILL_LIMIT;
      console.log(`[emailImapCron] account #${account.id} (${account.email}) 초기 백필 — 최근 ${opts.days || BACKFILL_DAYS}일`);
    } else {
      searchCriteria = [['UID', `${account.imap_last_uid + 1}:*`]];
      fetchCap = FETCH_LIMIT_PER_ACCOUNT;
    }
    const fetchOptions = { bodies: [''], markSeen: false, struct: true };
    const results = await conn.search(searchCriteria, fetchOptions);
    // 운영 #261 — 증분 수집은 **오래된 것부터** 잘라야 한다.
    //   커서(imap_last_uid)는 이번 tick 에서 처리한 uid 의 최댓값으로 전진한다(:531).
    //   최신 쪽(slice(-cap))을 집으면 한 tick 에 cap 을 넘는 순간, 처리하지 않은 오래된 메일 위로
    //   커서가 뛰어넘어 **다음 tick 의 검색 범위(UID cursor+1:*) 밖으로 영영 나간다** = 조용한 영구 유실.
    //   오래된 것부터 집으면 커서가 연속으로 전진해 초과분은 다음 tick 이 이어받는다.
    //   백필은 커서 연속성이 아니라 "최근 N일" 이 기준이라 최신 우선이 맞다(의도적 상한).
    results.sort((a, b) => (a.attributes.uid || 0) - (b.attributes.uid || 0));
    const limited = isBackfill ? results.slice(-fetchCap) : results.slice(0, fetchCap);

    let maxUid = account.imap_last_uid;
    let skippedSelfNotice = 0;   // #371 — 이번 회차에 건너뛴 자기발신 알림 수

    // workspace owner_id 가져옴 (file uploader_id 용)
    const biz = await Business.findByPk(account.business_id, { attributes: ['owner_id'] });
    const ownerId = biz ? biz.owner_id : null;

    // socket io 가져옴 (broadcast 용)
    const io = global.__planqIo;

    for (const r of limited) {
      const uid = r.attributes.uid;
      // 백필은 커서보다 오래된 메일을 일부러 가져오는 것 — 여기서 uid 로 걸러내면 전부 건너뛴다.
      //   (첫 sync 가 커서를 UIDNEXT-1 로 세팅해 둔 상태라 과거 메일 uid 는 항상 커서보다 작다)
      if (!isBackfill && uid <= account.imap_last_uid) continue;
      try {
        const fullBody = r.parts.find(p => p.which === '').body;
        const parsed = await simpleParser(fullBody);
        const messageId = parsed.messageId;
        if (!messageId) { maxUid = Math.max(maxUid, uid); continue; }

        // 중복 검사 (이미 동기화된 message_id)
        const existing = await EmailMessage.findOne({
          where: { business_id: account.business_id, message_id: messageId },
          attributes: ['id'],
        });
        if (existing) { maxUid = Math.max(maxUid, uid); continue; }

        const fromAddr = parsed.from && parsed.from.value && parsed.from.value[0];
        const fromEmail = (fromAddr && fromAddr.address) ? fromAddr.address.toLowerCase() : '';
        const fromName = (fromAddr && fromAddr.name) ? fromAddr.name : '';

        // ── #371 자기발신 알림메일 수집 차단 ──
        //   PlanQ 가 보낸 알림메일(SMTP_FROM)이 그대로 Q Mail 로 다시 수집되고 있었다.
        //   운영 실측 2026-08-22: inbound 2,274건 중 **826건(36%)**. 건당 body_html ~58KB(대부분 로고
        //   base64)라 매일 용량이 불고, 로고 File 524건 누적(#370)의 상위 원인이기도 하다.
        //   사용자는 같은 내용을 이미 앱 알림으로 받는다 — 메일함에 또 쌓을 이유가 없다.
        //
        //   ★ 판정은 **두 조건을 모두** 만족할 때만이다. 주소만 보면 사람이 그 주소로 보낸 진짜 메일까지
        //     삼킨다(help@ 는 실제 고객 응대 주소다). 자동발송 헤더는 우리가 붙인 것이라 위조 위험이 없다.
        //   ★ 되돌리려면 QMAIL_KEEP_SELF_NOTICE=1 만 켜면 된다 — 배포 없이 수집을 되살릴 수 있게.
        //     ("알림도 메일함에서 보고 싶다" 는 요구가 나오면 그때 이 스위치로 즉시 복구)
        const selfFrom = String(process.env.SMTP_FROM || '').toLowerCase().trim();
        if (selfFrom && fromEmail === selfFrom && process.env.QMAIL_KEEP_SELF_NOTICE !== '1') {
          const autoHdr = String(
            (parsed.headers && (parsed.headers.get ? parsed.headers.get('auto-submitted') : parsed.headers['auto-submitted'])) || ''
          ).toLowerCase();
          if (autoHdr && autoHdr !== 'no') {
            skippedSelfNotice += 1;
            maxUid = Math.max(maxUid, uid);
            continue;   // 저장하지 않는다 — 첨부(로고) File 도 따라서 생기지 않는다
          }
        }

        // thread 매칭
        const { thread, isNew } = await findOrCreateThread({
          businessId: account.business_id,
          accountId: account.id,
          parsed,
          fromEmail,
        });

        // client 매칭 (신규 thread 일 때만)
        let clientId = thread.client_id || null;
        if (isNew && fromEmail) {
          clientId = await matchClient(account.business_id, fromEmail);
        }

        // message insert
        const toEmails = (parsed.to && parsed.to.value) ? parsed.to.value.map(v => ({ email: v.address, name: v.name })) : [];
        const ccEmails = (parsed.cc && parsed.cc.value) ? parsed.cc.value.map(v => ({ email: v.address, name: v.name })) : null;

        // 이 메일이 **우리 쪽 어느 주소**로 왔는지 스레드에 박아둔다(별칭별 보기의 기반).
        //   이미 값이 있으면 덮지 않는다 — 대화의 최초 착지 주소가 그 대화의 성격이다.
        if (!thread.received_at_email) {
          try {
            const { EmailAccountAlias } = require('../models');
            const aliasRows = await EmailAccountAlias.findAll({ where: { account_id: account.id }, attributes: ['email'] });
            const ours = new Set([String(account.email || '').toLowerCase(), ...aliasRows.map(a => String(a.email).toLowerCase())]);
            const cand = [...(toEmails || []), ...(ccEmails || [])]
              .map(x => String(x && x.email || '').toLowerCase()).filter(Boolean)
              .find(e => ours.has(e));
            if (cand) await thread.update({ received_at_email: cand });
          } catch (e) { console.warn('[emailImapCron] received_at_email', e.message); }
        }

        const message = await EmailMessage.create({
          thread_id: thread.id,
          business_id: account.business_id,
          direction: 'inbound',
          message_id: messageId,
          in_reply_to: parsed.inReplyTo || null,
          references_chain: Array.isArray(parsed.references) ? parsed.references.join(' ') : (parsed.references || null),
          // 판정용 헤더를 여기서 남긴다 — 이걸 안 남기면 재판정 때 광고·자동발송 판정이 눈을 감는다.
          triage_headers: require('./emailTriage').pickTriageHeaders(parsed.headers),
          imap_uid: uid,
          from_email: fromEmail,
          from_name: fromName,
          to_emails: toEmails,
          cc_emails: ccEmails,
          subject: parsed.subject || null,
          body_html: parsed.html || null,
          body_text: parsed.text || null,
          is_read: false,
          delivery_status: 'delivered',
          sent_at: parsed.date || new Date(),
        });

        // attachments
        if (Array.isArray(parsed.attachments) && parsed.attachments.length > 0) {
          for (const att of parsed.attachments) {
            const fileId = await saveAttachmentAsFile({
              businessId: account.business_id,
              att,
              account,
              fallbackOwnerId: ownerId,
            });
            await EmailAttachment.create({
              message_id: message.id,
              file_id: fileId,
              filename: toNFC(att.filename || 'attachment'),   // #364 — 위 file_name 과 같은 축
              mime_type: att.contentType || null,
              size_bytes: att.size || (att.content ? att.content.length : null),
              content_id: att.contentId || att.cid || null,
              // #215-B — Content-ID 존재가 아니라 **본문이 실제 그 cid 를 참조하는가** 로 판정한다.
              //   `att.related` 는 쓰지 않는다: mailparser 상 "조상에 multipart/related 가 있다" 일 뿐 본문 참조를
              //   보장하지 않고, 무엇보다 **백필이 재계산할 수 없어**(원본 MIME 미보관) 쓰기측과 술어가 갈라진다.
              is_inline: isEmbedded(att.contentId || att.cid, parsed.html),
            });
          }
        }

        // thread 갱신
        // #164 — 미리보기는 정리된 본문에서. 날 parsed.text 앞부분은 전달/인용 헤더블록
        //   (From:/Sent:/원본주소) 이나 뉴스레터 프리헤더라 "영어조각·원본주소"로 시작했다.
        const { buildPreview } = require('./emailBodyClean');
        const preview = buildPreview(parsed.text, parsed.html, 500);
        // #200 — ★ 반드시 복제본에 push 한다. thread.participants 를 in-place 로 밀면 Sequelize 가
        //   변경을 감지하지 못해 UPDATE 에서 이 컬럼이 통째로 빠진다 → 운영 953 스레드 전원
        //   participants=[] 였고, findOrCreateThread 의 "제목+참여자" 매칭이 항상 실패해
        //   같은 제목 메일이 매번 새 스레드로 쪼개졌다(#200 "여러 건 겹친 경우 정리").
        //   #200(b') — 참여자 판정 술어를 services/emailAddress.js 로 단일화했다.
        //   "이 계정 주소(+별칭)가 아닌 모든 from/to/cc". 방향 무관 대칭 규칙 — inbound 의 to 를
        //   버리면 자기 주소로 발신된 메일이 자기 함에 도착한 스레드(운영 236건)가 상대를
        //   영영 못 갖는다. bcc 는 의도적 은닉 수신자라 제외한다.
        const participants = mergeParticipants(
          thread.participants,
          [
            { email: fromEmail, name: fromName },
            ...(Array.isArray(toEmails) ? toEmails : []),
            ...(Array.isArray(ccEmails) ? ccEmails : []),
          ],
          { excludeEmails: selfEmails },
        );
        // N+83 — Inbound 트리아지 (human/automated/marketing/spam). spam 판정은 classify 재사용.
        //   신규 스레드: 전체 분류 박제 + human 이면 reply_needed 자동 ON ("답변 필요" 폴더 작동).
        //   기존 스레드 후속 inbound: 사람 메일이면 reply_needed 복원 (status/triage 는 유지, spam/archived 제외).
        let triageFields = {};
        try {
          const { triageInbound } = require('./emailTriage');
          const { applyRules } = require('./mailSenderRules');
          const known = await isKnownContact(account.business_id, fromEmail);
          // ★ #221 — 여태 mailparser 의 **Map** 을 그대로 넘겼다. 대부분 술어는 Map 을 읽지만
          //   `isAddressedToUs`·`isThreadReply` 는 직접 프로퍼티 접근이라 Map 에서 **항상 false** 였고,
          //   그 결과 수집 시점에 "우리 주소로 직접 왔는가"·"우리 대화에 대한 회신인가" 판정이
          //   영구 미발동했다(실측 22 스레드, 그중 11건이 사용자에게 안 보임). 재판정 경로와 같은
          //   평문 객체로 정규화해 넘긴다 — 이제 두 경로의 입력이 구조상 같다.
          const trHeaders = require('./emailTriage').normalizeHeaders({
            headers: parsed.headers,
            toEmails,
            inReplyTo: parsed.inReplyTo,
            references: parsed.references,
          });
          const base = triageInbound({ subject: parsed.subject, bodyText: parsed.text, fromEmail, headers: trHeaders, ownEmails, ownMatcher, isKnownContact: known });
          // 학습된 발신자 규칙이 휴리스틱보다 우선한다 (사용자가 직접 알려준 정답).
          //   규칙은 분류만 바꾼다 — 원본 메일은 그대로라 규칙 삭제 시 즉시 원상복구.
          const tr = await applyRules(account.business_id, fromEmail, base);
          const ruleReason = tr.rule_applied ? 'rule' : 'inbound';
          // 백필(과거 메일)은 읽기만 — 이미 다른 데서 처리했을 가능성이 높다. 수백 건이 한꺼번에
          //   "답변 필요" 로 들어오면 그 폴더가 무용지물이 된다 (Irene 결정).
          const replyNeeded = isBackfill ? false : tr.reply_needed;
          const { threadFieldsForInbound } = require('./emailTriage');
          triageFields = threadFieldsForInbound({
            isNew, thread, tr, replyNeeded, ruleReason, messageDate: parsed.date,
          });
          // 백필(과거 메일)은 읽기만 — 이미 다른 데서 처리했을 가능성이 높다.
          if (isNew && isBackfill) triageFields.reply_needed_reason = 'backfill';
        } catch (e) { console.warn('[emailTriage]', e.message); }
        await thread.update({
          message_count: thread.message_count + 1,
          unread_count: thread.unread_count + 1,
          last_message_at: parsed.date || new Date(),
          last_message_direction: 'inbound',
          last_message_preview: preview,
          participants,
          client_id: clientId,
          ...triageFields,
        });

        // socket emit
        if (io) {
          io.to(`business:${account.business_id}`).emit('mail:new', {
            thread_id: thread.id,
            message_id: message.id,
            from_email: fromEmail,
            subject: parsed.subject,
            is_new_thread: isNew,
          });
        }

        // #203 — 새 메일 알림 (인앱 종 · 모바일 push · 답변필요는 이메일까지).
        //   여태 socket broadcast 만 하고 notify 호출이 없어 알림이 0건이었다 (CLAUDE.md §13).
        //   범위는 계정별 notify_scope, 수신자 분기(개인=본인만 / 회사=멤버 전원)는 mailNotify 안에서.
        //   과거분 백필(isBackfill)은 알리지 않는다 — 옛 메일 수백 통이 한꺼번에 울린다.
        if (!isBackfill) {
          try {
            const { notifyInboundMail } = require('./mailNotify');
            await notifyInboundMail({
              account, thread,
              fromName, fromEmail,
              subject: parsed.subject,
              messageId: parsed.messageId || null,   // 계정 간 같은 메일 알림 중복 제거 기준
              fields: triageFields,
              ioApp: io || global.__planqIo,
            });
          } catch (e) { console.error('[mailNotify] inbound', e.message); }
        }

        newCount++;
        maxUid = Math.max(maxUid, uid);
      } catch (e) {
        console.error(`[emailImapCron] message parse failed uid=${uid}:`, e.message);
        maxUid = Math.max(maxUid, uid);
      }
    }

    // last_uid + last_sync_at 갱신
    await account.update({
      imap_last_uid: maxUid,
      last_sync_at: new Date(),
      last_sync_error: null,
      fail_count: 0,
    });
  } finally {
    // #357 — 폴링 연결도 같은 함정. end() 가 비동기 EPIPE 를 던지면 리스너가 없어 프로세스가 죽는다.
    silenceLateErrors(conn && conn.imap);
    try { await conn.end(); } catch (_) { /* ignore */ }
  }

  // #371 — 건너뛴 수를 남긴다. 안 남기면 "정말 걸러지고 있는가" 를 확인할 방법이 로그에 없다
  //   (조용히 도는 필터는 나중에 죽어도 아무도 모른다).
  if (skippedSelfNotice > 0) {
    console.log(`[emailImapCron] account #${account.id} — 자기발신 알림 ${skippedSelfNotice}건 수집 건너뜀 (#371)`);
  }

  return newCount;
}

// 전체 cron tick
async function tick() {
  try {
    const liveBizIds = await liveBusinessIdSet();
    const accounts = (await EmailAccount.findAll({
      where: { is_active: true },
      // MySQL — NULL 먼저 (한 번도 sync 안 된 계정 우선)
      order: [
        [require('sequelize').literal('last_sync_at IS NULL'), 'DESC'],
        ['last_sync_at', 'ASC'],
      ],
      limit: 50,
    })).filter((a) => !liveBizIds || !a.business_id || liveBizIds.has(a.business_id));

    for (const acc of accounts) {
      // 실시간 IDLE 연결이 살아있는 계정은 이미 즉시 수신 중 — 폴링이 2번째 연결을 열어
      // Gmail 동시연결 제한(15)을 압박하는 것을 막는다. IDLE 이 끊긴(conn=null) 계정만 backstop 폴링.
      const idle = idleConns.get(acc.id);
      if (idle && idle.conn) continue;
      try {
        const n = await syncOne(acc);
        if (n > 0) console.log(`[emailImapCron] account #${acc.id} (${acc.email}) — ${n} new`);
      } catch (e) {
        const failCount = (acc.fail_count || 0) + 1;
        await acc.update({
          last_sync_error: String(e.message).slice(0, 1000),
          fail_count: failCount,
        });
        console.error(`[emailImapCron] account #${acc.id} sync failed (${failCount} consecutive):`, e.message);
        // 3회 연속 실패 → admin alert.
        // 단, "인증/설정이 안 된 계정"은 자동알림(메일) 발송 X — 노이즈 + 잘못된/없는 주소로 반송 방지.
        //   · neverSynced: 한 번도 성공 sync 안 됨 (검증 안 된 신규/잘못 등록 계정)
        //   · authConfigError: 자격증명 오류 (decrypt/password/auth/token 등) — 사용자가 재인증해야 하는 문제
        // → 둘 다 DB 에 last_sync_error 만 기록하고 자동메일 안 보냄. 사용자는 Settings 에서 상태 확인.
        // 재인증 필요 판정은 services/emailAccountHealth 단일 원천 (화면 배지와 같은 술어).
        const isAuthConfigError = needsReauth(e);
        const neverSynced = !acc.last_sync_at;
        if (failCount === FAIL_ALERT_THRESHOLD && !isAuthConfigError && !neverSynced) {
          try {
            const { notify } = require('../routes/notifications');
            const { User } = require('../models');
            const owners = await User.findAll({ where: { platform_role: 'platform_admin' }, attributes: ['id'] });
            for (const u of owners) {
              await notify({
                userId: u.id, businessId: acc.business_id,
                eventKind: 'system',
                title: `메일 계정 sync 실패 (3회 연속) — ${acc.email}`,
                body: e.message,
                ioApp: global.__planqIo,
              }).catch(() => {});
            }
          } catch (_) { /* ignore */ }
        } else if (failCount === FAIL_ALERT_THRESHOLD && isAuthConfigError && !neverSynced) {
          // 한 번은 성공했던 계정이 인증 오류로 죽었다 = 살아 있던 연결이 끊긴 것. 반드시 알린다.
          //   여태 이 분기가 통째로 침묵이라 help@irenewp.com 이 5일간 방치됐다(수신·발송 동반 사망).
          //   이메일 채널만 skip 한다 — 죽은 계정을 고치라는 안내가 그 계정으로 나가면 안 되고,
          //   잘못 등록된 주소로 반송이 쌓이는 것도 막아야 한다. 인앱·푸시는 보낸다.
          //   fail_count === 임계값 정확히 일치할 때만 발화하므로 반복 알림은 구조적으로 없다.
          try {
            const { notify } = require('../routes/notifications');
            const { BusinessMember } = require('../models');
            const targets = new Set();
            if (acc.owner_user_id) {
              targets.add(acc.owner_user_id);                       // 개인 계정 — 본인만
            } else {
              const owners = await BusinessMember.findAll({
                where: { business_id: acc.business_id, role: ['owner', 'admin'], removed_at: null },
                attributes: ['user_id'],
              });
              owners.forEach((m) => targets.add(m.user_id));         // 회사 계정 — owner/admin
            }
            for (const uid of targets) {
              await notify({
                userId: uid, businessId: acc.business_id,
                eventKind: 'system',
                title: `메일 계정 재연결이 필요합니다 — ${acc.email}`,
                body: '인증이 만료되어 메일 수신·발송이 중단됐습니다. 설정에서 다시 연결해 주세요.',
                link: '/business/settings/mail-accounts',
                skipChannels: ['email'],
                ioApp: global.__planqIo,
              }).catch(() => {});
            }
            console.warn(`[emailImapCron] account #${acc.id} (${acc.email}) — 재인증 필요 알림 발송 (${targets.size}명)`);
          } catch (_) { /* ignore */ }
        } else if (failCount === FAIL_ALERT_THRESHOLD) {
          console.warn(`[emailImapCron] account #${acc.id} (${acc.email}) — 한 번도 sync 성공한 적 없는 계정이라 자동알림 생략`);
        }
      }
    }
  } catch (e) {
    console.error('[emailImapCron] tick fatal:', e.message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// IMAP IDLE 매니저 — 진짜 실시간 수신 (폴링 X)
//   계정별 지속 IMAP 연결을 열어두고, 메일 서버가 새 메일을 push(IDLE)하면 node-imap 이
//   'mail' 이벤트를 즉시 emit → syncOne 트리거 → 파싱·저장·socket 'mail:new' broadcast.
//   전형 지연 < 2초 (Gmail 등 타 클라이언트와 동일 체감). 2분 cron 은 IDLE 끊김 대비 backstop.
// ────────────────────────────────────────────────────────────────────────────
// entry 형태: { conn, raw, stopped, connecting }
//   · conn(truthy) = 실시간 IDLE 연결 살아있음. drop 되면 conn=null 로 표시(엔트리는 유지 → backstop 폴링 대상).
//   · connecting = 연결 시도 중(플레이스홀더). 동시 connect 로 Gmail 동시연결 제한(15) 초과 방지.
const idleConns = new Map();     // accountId → { conn, raw, stopped, connecting }
// #357 ② — 계정별 재연결 발생 시각(최근 1시간). 임계치를 넘을 때만 error 로 승격한다.
// 소켓 종료 자체는 IMAP 에서 정상 이벤트라 error 로 남기면 진짜 오류가 묻힌다.
const RECONNECT_ALERT_PER_HOUR = 5;
const reconnectTimes = new Map(); // accountId → number[] (epoch ms)
function noteReconnect(accountId) {
  const now = Date.now();
  const arr = (reconnectTimes.get(accountId) || []).filter((t) => now - t < 3600000);
  arr.push(now);
  reconnectTimes.set(accountId, arr);
  return arr.length;
}

const idleBackoff = new Map();   // accountId → 다음 재연결 지연(ms)
const reconnectTimers = new Map(); // accountId → setTimeout 핸들 (재연결 중복 예약 차단)
const syncBusy = new Set();      // accountId 동기화 진행 중 (self-overlap 방지)
const syncPending = new Set();   // 진행 중 재요청 — 끝나면 한 번 더 (놓친 메일 방지)

// 계정 1개를 안전하게 동기화 (self-overlap 직렬화 + 최신 account 재로딩).
async function guardedSync(accountId) {
  if (syncBusy.has(accountId)) { syncPending.add(accountId); return; }
  syncBusy.add(accountId);
  try {
    do {
      syncPending.delete(accountId);
      const acc = await EmailAccount.findByPk(accountId);
      if (!acc || !acc.is_active) break;
      const n = await syncOne(acc);
      if (n > 0) console.log(`[emailIdle] account #${accountId} (${acc.email}) — ${n} new (idle push)`);
    } while (syncPending.has(accountId));
  } catch (e) {
    console.error(`[emailIdle] guardedSync #${accountId} failed:`, e.message);
  } finally {
    syncBusy.delete(accountId);
  }
}

// 예약된 재연결 타이머 취소 (중복/누수 방지)
function clearReconnect(id) {
  const t = reconnectTimers.get(id);
  if (t) { clearTimeout(t); reconnectTimers.delete(id); }
}

// ★ 끊긴 연결에 남는 **늦은 error 이벤트를 흡수**한다 (피드백 #357 의 진짜 원인).
//
//   EventEmitter 는 'error' 리스너가 하나도 없으면 그 에러를 **throw** 한다.
//   removeAllListeners() 로 리스너를 떼어낸 뒤 소켓에서 error 가 한 번 더 올라오면
//   → uncaughtException → **프로세스 재시작**. 로그의 Error 스택은 그 흔적이었다.
//   운영 실측(2026-08-21 error log): 그날 찍힌 Error 는 이 EPIPE 12건이 전부였고
//   부팅 경고는 25회 — 즉 하루 12회 크래시·재시작하고 있었다.
//
//   리스너를 떼는 것 자체는 재연결 재유발 차단에 필요하므로, 떼는 즉시 no-op error 리스너를 다시 건다.
function silenceLateErrors(raw) {
  if (!raw) return;
  try { raw.on('error', () => { /* 해체된 연결의 늦은 에러 — 흡수 */ }); } catch { /* */ }
  try {
    const sock = raw._sock;
    if (sock && typeof sock.on === 'function') sock.on('error', () => { /* 동상 */ });
  } catch { /* */ }
}

// 연결 해체 — end() 전에 리스너를 먼저 떼어 우리가 부른 end() 가 drop 핸들러(재연결)를 재트리거하지 않게 한다.
//   (Gmail 동시연결 누수의 핵심 원인: 의도적 end() → close/end 이벤트 → 또 다른 재연결 → 고아 연결 누적)
function teardownConn(entry) {
  if (!entry) return;
  const raw = entry.raw || (entry.conn && entry.conn.imap);
  try { if (raw) raw.removeAllListeners(); } catch { /* */ }
  silenceLateErrors(raw);
  // 이미 끊긴 소켓에 end() 를 부르면 writeAfterFIN → EPIPE 가 **비동기로** 올라온다.
  // 아래 try/catch 로는 못 잡는다(동기 throw 가 아니다) — 상태를 보고 아예 부르지 않는다.
  try {
    if (raw && raw.state === 'disconnected') return;
    entry.conn && entry.conn.end();
  } catch { /* */ }
}

function scheduleReconnect(account) {
  const id = account.id;
  const entry = idleConns.get(id);
  if (entry && entry.stopped) return;   // 의도적 중단이면 재연결 안 함
  if (reconnectTimers.has(id)) return;  // 이미 재연결 예약됨 — 중복 예약 차단 (한 drop 이 여러 이벤트여도 1개만)
  const prev = idleBackoff.get(id) || 0;
  const next = prev === 0 ? 5000 : Math.min(prev * 2, 300000);  // 5s → … → 5min cap
  idleBackoff.set(id, next);
  const t = setTimeout(() => {
    reconnectTimers.delete(id);
    startIdleForAccount(account).catch(() => {});
  }, next);
  reconnectTimers.set(id, t);
}

async function startIdleForAccount(account) {
  const id = account.id;
  const existing = idleConns.get(id);
  if (existing && existing.connecting) return;  // 이미 연결 시도 중 — 동시 connect 로 연결 2개 뜨는 것 차단
  clearReconnect(id);
  teardownConn(existing);                        // 기존 연결 리스너 제거 후 end (재연결 재유발 X)

  // connecting 플레이스홀더를 동기적으로 먼저 세팅 → reconcile/재연결 레이스에서 중복 진입 차단
  idleConns.set(id, { conn: null, raw: null, stopped: false, connecting: true });

  let conn;
  try {
    const imapConfig = await buildImapConfig(account, { onIdle: true });
    conn = await imaps.connect({ imap: imapConfig });
    await conn.openBox(account.imap_folder || 'INBOX');
  } catch (e) {
    // 연결 실패 — 플레이스홀더 정리(단, 그 사이 stop 요청 왔으면 존중) 후 재연결 예약
    if (conn) { silenceLateErrors(conn.imap); try { conn.end(); } catch { /* */ } }
    const cur = idleConns.get(id);
    if (cur && cur.stopped) { idleConns.delete(id); return; }
    idleConns.delete(id);
    console.warn(`[emailIdle] account #${id} (${account.email}) IDLE 연결 실패: ${e.message} — 재연결 예약`);
    scheduleReconnect(account);
    return;
  }

  // 연결 도중 stop 요청이 들어왔으면 즉시 정리
  const cur = idleConns.get(id);
  if (cur && cur.stopped) { silenceLateErrors(conn.imap); try { conn.end(); } catch { /* */ } idleConns.delete(id); return; }

  const raw = conn.imap;
  const entry = { conn, raw, stopped: false, connecting: false };
  idleConns.set(id, entry);
  idleBackoff.set(id, 0);  // 성공 → backoff 리셋
  console.log(`[emailIdle] IDLE 연결 성립 — account #${id} (${account.email})`);

  // 연결 직후 한 번 동기화 (IDLE 성립 전 도착분 회수)
  guardedSync(id).catch(() => {});

  // node-imap 이벤트는 conn.imap 에 있음
  raw.on('mail', () => { guardedSync(id).catch(() => {}); });          // 새 메일 push → 즉시
  raw.on('update', () => { guardedSync(id).catch(() => {}); });        // 플래그 변경 등

  let dropped = false;  // 한 물리적 disconnect 가 error+close+end 를 모두 발생시켜도 재연결은 1회만
  const onDrop = (label) => (err) => {
    if (dropped) return;
    dropped = true;
    try { raw.removeAllListeners(); } catch { /* */ }
    silenceLateErrors(raw);   // 리스너 0 상태에서 늦은 error 가 오면 프로세스가 죽는다 (#357)
    const e = idleConns.get(id);
    if (e && e.stopped) return;
    if (e) { e.conn = null; e.raw = null; }  // 연결 끊김 표시 → backstop 폴링이 커버 가능
    // #357 ② — 정상 재연결은 한 줄 warn. 같은 계정이 시간당 임계치를 넘을 때만 error 로 올린다.
    const perHour = noteReconnect(id);
    if (perHour > RECONNECT_ALERT_PER_HOUR) {
      console.error(`[emailIdle] account #${id} 재연결이 잦습니다 (최근 1시간 ${perHour}회) — 계정/네트워크 점검 필요`);
    }
    console.warn(`[emailIdle] account #${id} ${label}${err ? ': ' + err.message : ''} — 재연결 예약`);
    scheduleReconnect(account);
  };
  raw.on('error', onDrop('error'));
  raw.on('close', onDrop('close'));
  raw.on('end', onDrop('end'));
}

function stopIdleForAccount(accountId) {
  clearReconnect(accountId);
  const entry = idleConns.get(accountId);
  if (entry) { entry.stopped = true; teardownConn(entry); }
  idleConns.delete(accountId);
  idleBackoff.delete(accountId);
}

// 활성 계정 목록과 IDLE 연결을 맞춘다 — 신규 계정 연결, 제거된 계정 정리.
async function reconcileIdle() {
  try {
    const liveBizIds2 = await liveBusinessIdSet();
    const accounts = (await EmailAccount.findAll({ where: { is_active: true }, limit: 200 }))
      .filter((a) => !liveBizIds2 || !a.business_id || liveBizIds2.has(a.business_id));
    const activeIds = new Set(accounts.map((a) => a.id));
    // 제거/비활성된 계정 IDLE 정리
    for (const id of idleConns.keys()) { if (!activeIds.has(id)) stopIdleForAccount(id); }
    // 신규 계정 IDLE 시작
    for (const acc of accounts) { if (!idleConns.has(acc.id)) await startIdleForAccount(acc); }
  } catch (e) {
    console.error('[emailIdle] reconcile 실패:', e.message);
  }
}

function init() {
  // (1) IMAP IDLE — 진짜 실시간 수신 (주 채널). 계정별 지속 연결로 새 메일 즉시 push.
  reconcileIdle().catch(() => {});
  // 신규/제거 계정 반영 — 5분마다 IDLE 연결 목록 재조정
  cron.schedule('*/5 * * * *', () => { reconcileIdle().catch(() => {}); });
  // (2) 폴링 backstop — IDLE 이 조용히 끊긴 계정(모바일 네트워크·서버 idle timeout) 대비 안전망.
  //     IDLE 이 대부분 즉시 처리하므로 3분 backstop 으로 충분(부하 감소). fetch 후 socket 'mail:new'.
  cron.schedule('*/3 * * * *', () => { tick().catch(() => {}); });
  console.log('[emailImapCron] initialized — IMAP IDLE (실시간) + 3분 backstop 폴링');
}

//   findOrCreateThread 는 검증용으로도 노출한다 — 스레드 매칭(step1~3)은 IMAP 없이 검증할 수 있어야 한다.
module.exports = { init, tick, syncOne, isKnownContact, reconcileIdle, startIdleForAccount, stopIdleForAccount, findOrCreateThread };
