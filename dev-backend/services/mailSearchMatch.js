// Q Mail 검색 — "왜 이 메일이 검색에 걸렸나" (2026-09-11)
//
// Irene: "메일 검색하면 나오는 검색결과에서 검색된 단어 키워드 색상 표시해서 알게 해줘.
//         왜 그 검색결과가 거기 있는지 알게."
//
// 목록 행은 제목 · 미리보기(마지막 메시지) · 상대 이름 · 라벨만 그린다. 그런데 검색 술어
// (routes/email_threads.js)는 **스레드의 모든 메시지** 본문·제목·보낸사람까지 본다. 그래서
// "제목에도 미리보기에도 검색어가 없는 메일" 이 뜨고, 사용자는 왜 떴는지 알 수 없었다.
//
// 계약 — 행마다 `match: { field, snippet } | null`
//   field   : 'subject' | 'body' | 'sender' | 'label'
//   snippet : 행에 **안 보이는** 곳에서 맞았을 때만 평문 창(≤160자). 보이면 null(하이라이트로 충분).
//
// ★ 이 페이지에 실린 행에 대해서만 계산한다(목록 쿼리를 통과한 = 이미 계정 격리된 스레드).
// ★ 본문은 DB 에서 매칭 주변 360자만 잘라 온다 — 전체 body_text 를 끌어오지 않는다.
// ★ 판정 규칙은 목록 술어와 같은 모양: 토큰 AND(각 토큰이 어느 필드든) OR 공백 제거 통째.
'use strict';

const { sequelize } = require('../config/database');
const { parseSearchQuery, textMatches, makeSnippet, pickMatch } = require('../utils/searchMatch');

const escLike = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

// 행에 **보이는** 것 — MailPage 의 ThreadItem 과 같은 목록(보낸 사람 자리는 이름, 없으면 주소 @ 앞).
function shownFields(row) {
  const cp = row.counterpart || null;
  const senderShown = (cp && cp.name) || (cp && cp.email ? String(cp.email).split('@')[0] : null);
  return [
    { field: 'subject', text: row.subject, shown: true },
    { field: 'body', text: row.last_message_preview, shown: true },
    { field: 'sender', text: senderShown, shown: true },
    { field: 'label', text: Array.isArray(row.labels) ? row.labels : [], shown: true },
  ];
}

function flatTexts(fields) {
  const out = [];
  for (const f of fields) {
    const vals = Array.isArray(f.text) ? f.text : [f.text];
    for (const v of vals) if (v != null && v !== '') out.push(String(v));
  }
  return out;
}

// 보이는 것만으로 설명이 안 되는 첫 needle. 설명되면 null.
function unmetNeedle(row, pq) {
  const texts = flatTexts(shownFields(row));
  if (texts.some((t) => textMatches(t, pq.raw, { needle: pq.squashed }))) return null;
  for (const tk of pq.tokens) {
    if (!texts.some((t) => textMatches(t, pq.raw, { needle: tk }))) return tk;
  }
  return null;
}

async function resolveFromMessages(list, needle, pq, businessId) {
  if (!list.length) return;
  const ids = list.map((r) => r.id);
  const rows = await sequelize.query(
    `SELECT x.thread_id, x.subject, x.from_name, x.from_email, x.body_pos, x.body_win, x.body_len
       FROM (
         SELECT em.thread_id, em.subject, em.from_name, em.from_email,
                LOCATE(:needle, COALESCE(em.body_text, '')) AS body_pos,
                SUBSTRING(COALESCE(em.body_text, ''),
                          GREATEST(1, LOCATE(:needle, COALESCE(em.body_text, '')) - 120), 360) AS body_win,
                CHAR_LENGTH(COALESCE(em.body_text, '')) AS body_len,
                ROW_NUMBER() OVER (PARTITION BY em.thread_id ORDER BY em.id DESC) AS rn
           FROM email_messages em
          WHERE em.business_id = :bid
            AND em.thread_id IN (:ids)
            AND (em.body_text LIKE :kw OR em.subject LIKE :kw OR em.from_name LIKE :kw OR em.from_email LIKE :kw
                 OR REPLACE(em.subject, ' ', '') LIKE :kw
                 OR REPLACE(COALESCE(em.from_name, ''), ' ', '') LIKE :kw)
       ) x
      WHERE x.rn = 1`,
    {
      replacements: { bid: businessId, ids, needle, kw: `%${escLike(needle)}%` },
      type: sequelize.QueryTypes.SELECT,
    }
  );
  const byThread = new Map(rows.map((m) => [Number(m.thread_id), m]));
  const opts = { needle };
  for (const row of list) {
    const m = byThread.get(Number(row.id));
    if (!m) continue;
    // 보낸 사람 → 메시지 제목 → 본문. 짧고 분명한 설명이 먼저다.
    if (textMatches(m.from_name, pq.raw, opts) || textMatches(m.from_email, pq.raw, opts)) {
      const who = m.from_name && m.from_email ? `${m.from_name} <${m.from_email}>` : (m.from_name || m.from_email);
      const sn = makeSnippet(who, pq.raw, { ...opts, plain: true });
      row.match = { field: 'sender', snippet: sn ? sn.display : String(who).slice(0, 158) };
      continue;
    }
    if (m.subject && textMatches(m.subject, pq.raw, opts)) {
      const sn = makeSnippet(m.subject, pq.raw, { ...opts, plain: true });
      row.match = { field: 'subject', snippet: sn ? sn.display : null };
      continue;
    }
    const pos = Number(m.body_pos) || 0;
    if (pos > 0 && m.body_win) {
      const winStart = Math.max(1, pos - 120);
      const sn = makeSnippet(m.body_win, pq.raw, {
        ...opts,
        forceStart: winStart > 1,
        forceEnd: winStart - 1 + 360 < (Number(m.body_len) || 0),
      });
      row.match = { field: 'body', snippet: sn ? sn.display : null };
    }
  }
}

/**
 * rows: serializeThreadRow 결과(이 페이지). 각 행에 match 를 채운다(제자리 변경).
 */
async function attachMailMatches(rows, { query, businessId }) {
  const pq = parseSearchQuery(query);
  if (!pq.squashed || !Array.isArray(rows) || !rows.length) return rows;

  const pending = new Map();   // needle → rows
  const waiting = [];
  for (const row of rows) {
    const need = unmetNeedle(row, pq);
    if (need == null) {
      const hit = pickMatch(shownFields(row), pq.raw);
      row.match = hit ? { field: hit.field, snippet: null } : null;
      continue;
    }
    row.match = null;
    waiting.push(row);
    if (!pending.has(need)) pending.set(need, []);
    pending.get(need).push(row);
  }
  if (!waiting.length) return rows;

  // 1차 — 행에서 못 찾은 첫 토큰(보통 1 쿼리). 2차 — 공백 제거 통째로 걸린 경우(목록 술어의 OR 대안).
  for (const [needle, list] of pending.entries()) {
    await resolveFromMessages(list, needle, pq, businessId);
  }
  if (pq.tokens.length > 1) {
    const left = waiting.filter((r) => !r.match);
    if (left.length) await resolveFromMessages(left, pq.squashed, pq, businessId);
  }
  return rows;
}

module.exports = { attachMailMatches };
