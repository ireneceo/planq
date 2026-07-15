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
async function syncOne(account, opts = {}) {
  let imapConfig;
  if (account.auth_type === 'google_oauth') {
    // OAuth — access_token 으로 XOAUTH2 SASL 인증
    const gmailOauth = require('./gmail_oauth');
    let accessToken = decrypt(account.oauth_access_token_encrypted);
    // 만료 check + refresh
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
    // 옛 password 방식
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
        const preview = (parsed.text || '').slice(0, 500).replace(/\s+/g, ' ').trim();
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

function init() {
  // 2분 마다 — 수신 지연 단축(Irene: 실시간에 더 가깝게). fetch 후 socket 'mail:new' 로 UI 자동 갱신.
  //   (진짜 즉시는 IMAP IDLE push 필요 — 백로그. Gmail IMAP 2분 폴링은 rate-limit 여유.)
  cron.schedule('*/2 * * * *', () => { tick().catch(() => {}); });
  console.log('[emailImapCron] initialized — runs every 2 minutes');
}

module.exports = { init, tick, syncOne, isKnownContact };
