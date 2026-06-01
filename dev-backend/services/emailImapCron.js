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
  // aliases — JSON_CONTAINS
  const { sequelize } = require('../config/database');
  const [rows] = await sequelize.query(
    `SELECT id FROM clients WHERE business_id = ? AND JSON_SEARCH(email_aliases, 'one', ?) IS NOT NULL LIMIT 1`,
    { replacements: [businessId, fromEmail] }
  );
  return rows[0] ? rows[0].id : null;
}

// attachment File 자동 저장 (visibility=L3, folder 'Email Attachments')
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
async function syncOne(account) {
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

  let newCount = 0;
  try {
    const box = await conn.openBox(account.imap_folder);
    // 첫 sync (imap_last_uid=0) — UIDNEXT-1 로 init (앞으로 도착하는 메일만)
    // 옛 메일 backfill 은 별도 API (account.backfill_days 옵션 추후)
    if (account.imap_last_uid === 0 && box.uidnext) {
      const initUid = box.uidnext - 1;
      await account.update({ imap_last_uid: initUid, last_sync_at: new Date(), last_sync_error: null });
      console.log(`[emailImapCron] account #${account.id} (${account.email}) first sync init — last_uid=${initUid} (INBOX has ${box.messages?.total || '?'} messages, only new mail will be fetched)`);
      try { await conn.end(); } catch (_) { /* ignore */ }
      return 0;
    }
    const searchCriteria = [['UID', `${account.imap_last_uid + 1}:*`]];
    const fetchOptions = { bodies: [''], markSeen: false, struct: true };
    const results = await conn.search(searchCriteria, fetchOptions);
    const limited = results.slice(0, FETCH_LIMIT_PER_ACCOUNT);

    let maxUid = account.imap_last_uid;

    // workspace owner_id 가져옴 (file uploader_id 용)
    const biz = await Business.findByPk(account.business_id, { attributes: ['owner_id'] });
    const ownerId = biz ? biz.owner_id : null;

    // socket io 가져옴 (broadcast 용)
    const io = global.__planqIo;

    for (const r of limited) {
      const uid = r.attributes.uid;
      if (uid <= account.imap_last_uid) continue;
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
        await thread.update({
          message_count: thread.message_count + 1,
          unread_count: thread.unread_count + 1,
          last_message_at: parsed.date || new Date(),
          last_message_direction: 'inbound',
          last_message_preview: preview,
          participants,
          client_id: clientId,
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
  // 5분 마다 — '*/5 * * * *'
  cron.schedule('*/5 * * * *', () => { tick().catch(() => {}); });
  console.log('[emailImapCron] initialized — runs every 5 minutes');
}

module.exports = { init, tick, syncOne };
