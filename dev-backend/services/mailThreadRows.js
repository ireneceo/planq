// Q mail 목록 행 만들기 — 폴더 목록·검색(routes/email_threads)과 «이 주소와 오간 메일»(routes/email_addresses)이 같이 쓴다.
//
// ★ 2026-10-20 (Irene: *"메일주소로 검색하면 unknown 이라고 표시가 되잖아. 그리고 다시 받은 메일이랑 연결된
//   우리가 보낸 메일이나 과거 메일을 알 수가 없네."*)
//   주소 보기 라우트가 이 과정을 건너뛰고 스레드 날 행(id·제목·상태)만 줘서, 화면의 보낸 사람 자리가
//   «(unknown)» 이었고 「보낸」 표시·미리보기·메일함도 비어 우리가 보낸 메일과 받은 메일이 구별되지 않았다.
//   행을 만드는 길을 둘 두면 다시 갈라진다 — 여기 한 벌만 둔다.
//
// 입력 rows: EmailThread 인스턴스(EmailAccount·Client·Project include 포함). N+1 없음 — 행 묶음당 쿼리 몇 개.
const { sequelize } = require('../config/database');
const { SENT_VIA_SQL } = require('./mailFolders');
const { NOISE_MIMES } = require('./emailAttachments');
const { serializeThreadRow, resolveRecipientNames, resolveNamesForEmails, searchPartiesByThread } = require('./mailSerialize');

// HTML → 미리보기 텍스트 (480자) — 스레드 last_message_preview / body_text 용
function htmlToPreview(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 480);
}

// q: 검색어(«@» 가 든 토큰이 있으면 그 주소의 사람을 보낸 사람 자리에 — mailSerialize.searchPartiesByThread).
//    주소 보기는 그 주소를 q 로 넘긴다 — 그 사람과 오간 목록이니 행마다 그 사람이 보여야 한다.
async function buildThreadRows(rows, { folder, businessId, sentVia = null, q = null }) {
  // 상대방(발신자) — 목록의 "보낸 사람" 자리.
  //   여태 이 값을 안 내려줘서 프론트가 내 메일함 이름(account.display_name)을 발신자로 그렸다
  //   → PlanQ 가 보낸 알림이 Q Mail 안에서만 "IRENE WP"(내 계정명)로 보였다.
  //   발신자가 헤더에 넣은 이름은 email_messages.from_name 에 그대로 있다. 그걸 쓴다.
  //   (participants JSON 은 옛 row 에 이름이 비어 있어 신뢰할 수 없다 — fallback 으로만.)
  const threadIds = rows.map(r => r.id);
  const senderByThread = new Map();
  const lastOutByThread = new Map();
  if (threadIds.length > 0) {
    const lastInbound = await sequelize.query(
      `SELECT em.thread_id, em.from_name, em.from_email
         FROM email_messages em
         JOIN (SELECT thread_id, MAX(id) AS mid
                 FROM email_messages
                WHERE thread_id IN (:ids) AND direction = 'inbound'
             GROUP BY thread_id) last ON last.mid = em.id`,
      { replacements: { ids: threadIds }, type: sequelize.QueryTypes.SELECT }
    );
    for (const m of lastInbound) {
      senderByThread.set(m.thread_id, { name: m.from_name || null, email: m.from_email || null });
    }
    // "응답 없음 N일" 판정용 — 마지막 보낸 메일이 실제로 나갔는지 확인해야 한다.
    //   못 나간 걸 "응답 없음" 으로 표시하면 사용자가 상대를 탓하게 된다.
    //   #262 — 보낸메일함 행 표시도 이 배치 결과를 쓴다 (수신자·내 발송시각·내 발송 미리보기).
    //   새 쿼리를 만들지 않고 컬럼만 넓힌다 (N+1 금지).
    const lastOut = await sequelize.query(
      `SELECT em.thread_id, em.delivery_status, em.to_emails, em.sent_at, em.internal_only,
              (em.sent_by_user_id IS NOT NULL) AS via_planq,
              LEFT(COALESCE(em.body_text, ''), 200) AS preview
         FROM email_messages em
         JOIN (SELECT thread_id, MAX(id) AS mid
                 FROM email_messages
                WHERE thread_id IN (:ids) AND direction = 'outbound'${sentVia ? ` AND ${SENT_VIA_SQL[sentVia]}` : ''}
             GROUP BY thread_id) last ON last.mid = em.id`,
      { replacements: { ids: threadIds }, type: sequelize.QueryTypes.SELECT }
    );
    for (const m of lastOut) {
      lastOutByThread.set(m.thread_id, {
        delivery_status: m.delivery_status,
        internal_only: !!m.internal_only,
        via: Number(m.via_planq) ? 'planq' : 'other',
        to_emails: m.to_emails,
        sent_at: m.sent_at,
        preview: m.preview,
      });
    }
  }

  // 운영 #324 — 보낸메일함의 "받는 사람" 표시이름 해석.
  //   outbound 의 to_emails 에는 주소 문자열만 들어 있어, 워크스페이스가 이미 아는 이름으로
  //   해석해 줘야 받은메일함과 같은 이름이 뜬다. 규칙·쿼리는 services/mailSerialize 에 있다.
  const nameByEmail = await resolveRecipientNames({ folder, lastOutByThread, businessId });

  // #215-I — 첨부 유무 배치 집계 (원문 "첨부파일 있고 없고도 알기 편하게" — 열기 전에 인지).
  //   목록은 body_html 을 로드하지 않으므로 detail 의 `isEmbedded(cid, body)` 술어를 그대로 쓸 수 없다.
  //   대신 `is_inline` 컬럼을 쓴다 — B(쓰기측 교정)+C(백필) 이후 이 컬럼은 **같은 술어의 물질화 캐시**라
  //   목록 클립 ↔ 상세 칩이 정의상 일치한다("클립 보고 열었는데 첨부가 없는" 배신이 구조적으로 불가능).
  //   ★ 그 대가로 C 백필이 리스트 표시의 데이터 전제가 된다 — 설계 §9-1 이 백필을 배포 완료 조건으로 격상.
  //   N+1 없음: threadIds 1 쿼리.
  const attachCountByThread = new Map();
  if (threadIds.length > 0) {
    const attRows = await sequelize.query(
      `SELECT em.thread_id, COUNT(*) AS cnt
         FROM email_attachments ea
         JOIN email_messages em ON em.id = ea.message_id
        WHERE em.business_id = :bid AND em.thread_id IN (:ids)
          AND ea.is_inline = 0
          AND ea.file_id IS NOT NULL
          AND (ea.mime_type IS NULL OR LOWER(ea.mime_type) NOT IN (:noise))
        GROUP BY em.thread_id`,
      {
        replacements: { bid: businessId, ids: threadIds, noise: [...NOISE_MIMES] },
        type: sequelize.QueryTypes.SELECT,
      }
    );
    for (const r of attRows) attachCountByThread.set(r.thread_id, Number(r.cnt) || 0);
  }

  const searchParties = q
    ? await searchPartiesByThread({ q, threadIds, businessId })
      .catch((err) => { console.error('[email-threads] search party err:', err.message); return null; })
    : null;
  const data = rows.map((t) => serializeThreadRow(t, {
    folder, senderByThread, lastOutByThread, attachCountByThread, nameByEmail, searchParties,
  }));
  // 이름 없는 상대 — 워크스페이스가 아는 이름으로(보낸메일함 #324 와 같은 규칙). 없으면 화면이 주소를 그린다.
  const nameless = data.filter((d) => d.counterpart && !d.counterpart.name && d.counterpart.email).map((d) => d.counterpart.email);
  if (nameless.length) {
    const known = await resolveNamesForEmails(nameless, businessId)
      .catch((err) => { console.error('[email-threads] name resolve err:', err.message); return new Map(); });
    for (const d of data) {
      if (d.counterpart && !d.counterpart.name && d.counterpart.email) {
        const nm = known.get(String(d.counterpart.email).trim().toLowerCase());
        if (nm) d.counterpart.name = nm;
      }
    }
  }

  // ★ 2026-09-29 운영 #438 — **답을 기다리는 쪽의 말을 보여준다.**
  //   Irene: *"답변필요한 고객의 리플이 우리 보낸메일로 표시되고 아예 안나와서 볼 수 없어."*
  //   임시 답변(holding)을 보내면 스레드는 답변 필요에 남는데 행 미리보기는 `last_message_preview`
  //   (= 방금 우리가 보낸 임시 답변)에 「보낸」 태그까지 붙어, 답해야 할 고객 메일이 목록에서 사라져 보였다.
  //   답변 필요 행의 미리보기는 **마지막 받은 메일**이다. 1 쿼리(N+1 없음), 이 페이지 행만.
  const waitingIds = data.filter((d) => d.reply_needed && d.last_message_direction === 'outbound').map((d) => d.id);
  if (waitingIds.length > 0) {
    const lastIn = await sequelize.query(
      `SELECT em.thread_id, em.from_email, em.from_name, em.sent_at,
              LEFT(COALESCE(em.body_text, ''), 480) AS preview
         FROM email_messages em
         JOIN (SELECT thread_id, MAX(id) AS mid
                 FROM email_messages
                WHERE business_id = :bid AND thread_id IN (:ids) AND direction = 'inbound'
             GROUP BY thread_id) last ON last.mid = em.id`,
      { replacements: { bid: businessId, ids: waitingIds }, type: sequelize.QueryTypes.SELECT }
    );
    const byThread = new Map(lastIn.map((m) => [m.thread_id, m]));
    for (const d of data) {
      const m = byThread.get(d.id);
      if (m) d.reply_preview = htmlToPreview(m.preview) || null;
    }
  }
  return data;
}

module.exports = { buildThreadRows, htmlToPreview };
