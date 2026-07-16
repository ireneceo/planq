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
const {
  EmailAccount, EmailThread, EmailMessage, EmailAttachment, EmailThreadParticipant,
  Client, File: FileModel, Business,
} = require('../models');

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

async function saveAttachmentAsFile({ businessId, fromEmail, att, accountUserId }) {
  try {
    const ym = new Date().toISOString().slice(0, 7);
    const dir = path.join(UPLOAD_ROOT, String(businessId), 'email', ym);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(att.filename || '') || '';
    const uuid = crypto.randomBytes(16).toString('hex');
    const fname = `${uuid}${ext}`;
    const fpath = path.join(dir, fname);
    fs.writeFileSync(fpath, att.content);
    const file = await FileModel.create({
      business_id: businessId,
      uploader_id: accountUserId || null,
      file_name: att.filename || `attachment${ext}`,
      file_path: fpath,
      file_size: att.size || att.content.length,
      mime_type: att.contentType || 'application/octet-stream',
      storage_provider: 'planq',
      project_id: null,
      visibility: 'L3',
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
  const { buildOwnEmailSet } = require('./emailTriage');
  const ownEmails = await buildOwnEmailSet(account.business_id);

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
    const limited = results.slice(-fetchCap);   // 백필은 최신 것 우선

    let maxUid = account.imap_last_uid;

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
              fromEmail,
              att,
              accountUserId: ownerId,
            });
            await EmailAttachment.create({
              message_id: message.id,
              file_id: fileId,
              filename: att.filename || 'attachment',
              mime_type: att.contentType || null,
              size_bytes: att.size || (att.content ? att.content.length : null),
              content_id: att.contentId || att.cid || null,
              is_inline: !!(att.cid || att.contentId),
            });
          }
        }

        // thread 갱신
        // #164 — 미리보기는 정리된 본문에서. 날 parsed.text 앞부분은 전달/인용 헤더블록
        //   (From:/Sent:/원본주소) 이나 뉴스레터 프리헤더라 "영어조각·원본주소"로 시작했다.
        const { buildPreview } = require('./emailBodyClean');
        const preview = buildPreview(parsed.text, parsed.html, 500);
        const participants = Array.isArray(thread.participants) ? thread.participants : [];
        const existingPart = participants.find(p => p.email && p.email.toLowerCase() === fromEmail);
        if (!existingPart && fromEmail) {
          participants.push({ email: fromEmail, name: fromName, is_internal: false });
        }
        // N+83 — Inbound 트리아지 (human/automated/marketing/spam). spam 판정은 classify 재사용.
        //   신규 스레드: 전체 분류 박제 + human 이면 reply_needed 자동 ON ("답변 필요" 폴더 작동).
        //   기존 스레드 후속 inbound: 사람 메일이면 reply_needed 복원 (status/triage 는 유지, spam/archived 제외).
        let triageFields = {};
        try {
          const { triageInbound } = require('./emailTriage');
          const { applyRules } = require('./mailSenderRules');
          const known = await isKnownContact(account.business_id, fromEmail);
          const base = triageInbound({ subject: parsed.subject, bodyText: parsed.text, fromEmail, headers: parsed.headers, ownEmails, isKnownContact: known });
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
    try { await conn.end(); } catch (_) { /* ignore */ }
  }

  return newCount;
}

// 전체 cron tick
async function tick() {
  try {
    const accounts = await EmailAccount.findAll({
      where: { is_active: true },
      // MySQL — NULL 먼저 (한 번도 sync 안 된 계정 우선)
      order: [
        [require('sequelize').literal('last_sync_at IS NULL'), 'DESC'],
        ['last_sync_at', 'ASC'],
      ],
      limit: 50,
    });
    for (const acc of accounts) {
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
        const errMsg = String(e.message || '');
        const isAuthConfigError = /decrypt|password|auth|credential|login|xoauth|token|invalid|missing/i.test(errMsg);
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
        } else if (failCount === FAIL_ALERT_THRESHOLD) {
          console.warn(`[emailImapCron] account #${acc.id} (${acc.email}) — 인증/설정 미완 또는 미검증 계정이라 자동알림 생략`);
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
const idleConns = new Map();     // accountId → { conn, stopped }
const idleBackoff = new Map();   // accountId → 다음 재연결 지연(ms)
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

function scheduleReconnect(account) {
  const id = account.id;
  const entry = idleConns.get(id);
  if (entry && entry.stopped) return;  // 의도적 중단이면 재연결 안 함
  const prev = idleBackoff.get(id) || 0;
  const next = prev === 0 ? 5000 : Math.min(prev * 2, 300000);  // 5s → … → 5min cap
  idleBackoff.set(id, next);
  setTimeout(() => { startIdleForAccount(account).catch(() => {}); }, next);
}

async function startIdleForAccount(account) {
  const id = account.id;
  // 기존 연결 정리
  const existing = idleConns.get(id);
  if (existing && existing.conn) { try { existing.conn.end(); } catch { /* */ } }

  try {
    const imapConfig = await buildImapConfig(account, { onIdle: true });
    const conn = await imaps.connect({ imap: imapConfig });
    await conn.openBox(account.imap_folder || 'INBOX');
    idleConns.set(id, { conn, stopped: false });
    idleBackoff.set(id, 0);  // 성공 → backoff 리셋
    console.log(`[emailIdle] IDLE 연결 성립 — account #${id} (${account.email})`);

    // 연결 직후 한 번 동기화 (IDLE 성립 전 도착분 회수)
    guardedSync(id).catch(() => {});

    // node-imap 이벤트는 conn.imap 에 있음
    const raw = conn.imap;
    raw.on('mail', () => { guardedSync(id).catch(() => {}); });          // 새 메일 push → 즉시
    raw.on('update', () => { guardedSync(id).catch(() => {}); });        // 플래그 변경 등
    const onDrop = (label) => (err) => {
      const e = idleConns.get(id);
      if (e && e.stopped) return;
      console.warn(`[emailIdle] account #${id} ${label}${err ? ': ' + err.message : ''} — 재연결 예약`);
      scheduleReconnect(account);
    };
    raw.on('error', onDrop('error'));
    raw.on('close', onDrop('close'));
    raw.on('end', onDrop('end'));
  } catch (e) {
    console.warn(`[emailIdle] account #${id} (${account.email}) IDLE 연결 실패: ${e.message} — 재연결 예약`);
    scheduleReconnect(account);
  }
}

function stopIdleForAccount(accountId) {
  const entry = idleConns.get(accountId);
  if (entry) { entry.stopped = true; try { entry.conn && entry.conn.end(); } catch { /* */ } }
  idleConns.delete(accountId);
  idleBackoff.delete(accountId);
}

// 활성 계정 목록과 IDLE 연결을 맞춘다 — 신규 계정 연결, 제거된 계정 정리.
async function reconcileIdle() {
  try {
    const accounts = await EmailAccount.findAll({ where: { is_active: true }, limit: 200 });
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

module.exports = { init, tick, syncOne, isKnownContact, reconcileIdle, startIdleForAccount, stopIdleForAccount };
