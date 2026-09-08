// services/mailBrief.js — 메일 한 통을 **읽지 않고도 판단**할 수 있게 만드는 브리프.
//
// Irene 2026-09-08: *"이 번역 옆에 메일 요약 및 검증이 나와서 누르면 번역 처럼 요약내용
//   간략하게 알려주고 실제 메일이 어떤 상황인지 믿어도 되는지 그리고 연결된 프로젝트나
//   고객이 있다면 추가로 어느 순간인지 알려줄 수 있어?"*
//
// ★ **검증은 지어내지 않는다.** "믿어도 되는지" 를 LLM 에게 물으면 그럴듯한 거짓말이 나온다 —
//   그리고 그 거짓말은 사용자가 첨부를 여는 근거가 된다. 신뢰 판정은 **전부 결정적 신호**로만 만든다:
//   발신 이력 · 등록 고객 여부 · 표시이름↔도메인 불일치 · 링크 텍스트↔실제 주소 불일치 ·
//   첨부 확장자 · 대량발송 헤더 · 스팸 점수 · (있으면) 인증 결과 헤더.
//   LLM 은 **요약과 다음 행동 제안**만 쓴다. 두 영역을 섞지 않는 것이 이 파일의 설계다.
//
// 회귀는 `node scripts/e2e/run.js --suite mailbrief` 가 막는다(신호마다 양성/음성 대조군).
const { Op } = require('sequelize');
const {
  EmailThread, EmailMessage, Client, Project, ProjectStage, Invoice, Task, Business,
} = require('../models');

// ─── 신뢰 신호 ────────────────────────────────────────────────
// level 세 단계. 'danger' 하나라도 있으면 전체가 danger, 없고 warn 이 있으면 caution.
const LEVELS = { ok: 0, info: 0, warn: 1, danger: 2 };

/** 실행되면 곤란한 첨부. 이중 확장자(invoice.pdf.exe)도 여기서 걸린다. */
const RISKY_EXT = new Set([
  'exe', 'scr', 'com', 'pif', 'bat', 'cmd', 'js', 'jse', 'vbs', 'vbe', 'wsf', 'wsh',
  'lnk', 'msi', 'jar', 'ps1', 'reg', 'hta', 'cpl', 'iso', 'img',
]);

function domainOf(email) {
  // ★ `Kim <a@b.com>` 형태가 온다. 꺾쇠를 먼저 벗기지 않으면 `@([^>\s]+)$` 가
  //   끝(`>`)에 닿지 못해 **빈 문자열**이 나온다 — 그러면 첫 접촉·사칭 판정이 통째로 죽는다
  //   (카나리 `--suite mailbrief` 가 잡았다).
  const raw = String(email || '').toLowerCase().trim();
  const inAngle = raw.match(/<([^>]+)>/);
  const addr = (inAngle ? inAngle[1] : raw).trim();
  const at = addr.lastIndexOf('@');
  if (at < 0) return '';
  return addr.slice(at + 1).replace(/[>,;\s]+$/, '');
}

/** 앵커 텍스트가 주소처럼 보이는데 실제 링크가 다른 곳으로 가는가 — 피싱의 고전적 신호. */
function findLinkMismatches(html) {
  const out = [];
  if (!html) return out;
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  let scanned = 0;
  while ((m = re.exec(html)) && scanned < 200) {
    scanned += 1;
    const href = m[1];
    const text = String(m[2]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    // 텍스트가 도메인/URL 처럼 보일 때만 비교한다. 평범한 문구는 원래 주소와 다르다.
    const looksLikeHost = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(text);
    if (!looksLikeHost) continue;
    let realHost = '';
    let shownHost = '';
    try { realHost = new URL(href, 'https://x.invalid').hostname.toLowerCase(); } catch { continue; }
    try { shownHost = new URL(text.startsWith('http') ? text : `https://${text}`).hostname.toLowerCase(); } catch { continue; }
    if (!realHost || !shownHost || realHost === 'x.invalid') continue;
    // 서브도메인 관계는 같은 곳으로 본다 (mail.planq.kr ↔ planq.kr)
    const same = realHost === shownHost
      || realHost.endsWith(`.${shownHost}`) || shownHost.endsWith(`.${realHost}`);
    if (!same) out.push({ shown: shownHost, real: realHost });
    if (out.length >= 3) break;
  }
  return out;
}

/** 헤더에서 인증 결과를 읽는다. 없으면 'unknown' — **모른다와 실패는 다르다.** */
function readAuthResult(headers) {
  const raw = String((headers && (headers['authentication-results'] || headers['received-spf'])) || '');
  if (!raw) return null;
  const low = raw.toLowerCase();
  const grab = (k) => {
    const m = low.match(new RegExp(`${k}=(\\w+)`));
    return m ? m[1] : null;
  };
  return { spf: grab('spf'), dkim: grab('dkim'), dmarc: grab('dmarc'), raw: raw.slice(0, 300) };
}

async function collectTrustSignals({ businessId, thread, message, clientRow }) {
  const signals = [];
  const add = (code, level, detail) => signals.push({ code, level, detail });
  const headers = (message.triage_headers && typeof message.triage_headers === 'object') ? message.triage_headers : {};

  // 우리가 보낸 메일은 검증 대상이 아니다.
  if (message.direction === 'outbound') {
    add('outbound', 'ok', 'our_team');
    return { level: 'ok', signals };
  }

  const from = String(message.from_email || '').toLowerCase();
  const fromDomain = domainOf(from);

  // ① 발신 이력 — 이 주소와 전에 주고받은 적이 있는가. 첫 접촉은 그 자체로 주의 신호다.
  const priorCount = await EmailMessage.count({
    where: {
      business_id: businessId, direction: 'inbound', from_email: from,
      id: { [Op.ne]: message.id },
    },
  });
  if (priorCount > 0) add('sender_history', 'ok', String(priorCount));
  else add('first_contact', 'warn', fromDomain || 'unknown');

  // ② 등록된 고객인가 — 우리 원장에 있는 상대면 신뢰도가 올라간다.
  if (clientRow) add('known_client', 'ok', clientRow.display_name || clientRow.company_name || '');

  // ③ 표시이름 ↔ 도메인. 표시이름에 등록 고객사 이름이 들어 있는데 도메인이 그 고객 도메인이
  //    아니면 사칭 가능성이다. 우리 워크스페이스 이름을 사칭하는 경우도 같이 본다.
  const fromName = String(message.from_name || '').trim();
  if (fromName && fromDomain) {
    // 워크스페이스 표시 이름 — brand_name 이 정본이고 name 은 legacy 호환이다(models/Business).
    const biz = await Business.findByPk(businessId, { attributes: ['name', 'brand_name'] });
    const bizName = String(biz?.brand_name || biz?.name || '').trim();
    const ourDomains = new Set(
      (await EmailMessage.findAll({
        where: { business_id: businessId, direction: 'outbound' },
        attributes: ['from_email'], limit: 200, order: [['id', 'DESC']],
      })).map((m) => domainOf(m.from_email)).filter(Boolean),
    );
    if (bizName && bizName.length >= 2 && fromName.includes(bizName) && !ourDomains.has(fromDomain)) {
      add('display_name_mismatch', 'danger', `${fromName} <${fromDomain}>`);
    }
  }

  // ④ 링크 텍스트 ↔ 실제 주소
  const mismatches = findLinkMismatches(message.body_html);
  if (mismatches.length) {
    add('link_mismatch', 'danger', mismatches.map((x) => `${x.shown}→${x.real}`).join(', '));
  }

  // ⑤ 첨부 확장자
  const atts = Array.isArray(message.attachments) ? message.attachments : [];
  // EmailAttachment 의 파일명 컬럼은 `filename` 이다(File/TaskAttachment 와 이름이 다르다).
  const risky = atts.map((a) => String(a.filename || a.file_name || ''))
    .filter((n) => RISKY_EXT.has(n.split('.').pop().toLowerCase()));
  if (risky.length) add('attachment_risk', 'danger', risky.join(', '));

  // ⑥ 대량 발송 — 위험은 아니지만 "사람이 나에게 쓴 편지" 가 아니라는 사실이 판단에 필요하다.
  if (headers['list-unsubscribe'] || headers['list-id'] || headers['feedback-id'] || headers['x-sg-eid']) {
    add('bulk_mail', 'info', 'list_headers');
  }

  // ⑦ 외부 스팸 필터 + 우리 자체 판정
  const spamStatus = String(headers['x-spam-status'] || headers['x-spam-flag'] || '');
  if (/^yes\b/i.test(spamStatus)) add('external_spam_flag', 'danger', spamStatus.slice(0, 80));
  if (thread.status === 'spam') add('marked_spam', 'danger', 'thread_status');
  else if (typeof thread.spam_score === 'number' && thread.spam_score >= 0.6) {
    add('spam_score', 'warn', String(thread.spam_score));
  }

  // ⑧ 인증 결과 — **없으면 없다고 말한다.** 모르는 것을 통과로 세지 않는다.
  const auth = readAuthResult(headers);
  if (auth) {
    const bad = ['spf', 'dkim', 'dmarc'].filter((k) => auth[k] && auth[k] !== 'pass' && auth[k] !== 'none');
    if (bad.length) add('auth_fail', 'danger', bad.map((k) => `${k}=${auth[k]}`).join(', '));
    else add('auth_pass', 'ok', ['spf', 'dkim', 'dmarc'].filter((k) => auth[k]).map((k) => `${k}=${auth[k]}`).join(', '));
  } else {
    add('auth_unknown', 'info', 'no_header');
  }

  const worst = signals.reduce((acc, s) => Math.max(acc, LEVELS[s.level] ?? 0), 0);
  return { level: worst === 2 ? 'danger' : worst === 1 ? 'caution' : 'ok', signals };
}

// ─── 연결된 맥락 — "지금 어느 순간인가" ────────────────────────
async function collectLinks({ businessId, thread }) {
  const out = { client: null, project: null, stage: null, next_action: null, invoices: [], tasks: [] };

  if (thread.client_id) {
    const c = await Client.findOne({
      where: { id: thread.client_id, business_id: businessId },
      attributes: ['id', 'display_name', 'company_name'],
    });
    if (c) out.client = { id: c.id, name: c.display_name || c.company_name || '' };
  }

  if (thread.project_id) {
    const p = await Project.findOne({
      where: { id: thread.project_id, business_id: businessId },
      attributes: ['id', 'name', 'status'],
    });
    if (p) {
      out.project = { id: p.id, name: p.name, status: p.status };
      // 거래 시퀀스 — 지금 활성 단계와 다음에 할 일. 엔진이 이미 계산해 둔 값을 그대로 쓴다
      //   (여기서 다시 계산하면 화면과 갈라진다).
      const stages = await ProjectStage.findAll({
        where: { project_id: p.id },
        attributes: ['id', 'kind', 'label', 'status', 'order_index'],
        order: [['order_index', 'ASC']],
      });
      const active = stages.find((s) => s.status === 'active')
        || stages.find((s) => s.status === 'pending');
      if (active) out.stage = { kind: active.kind, label: active.label, status: active.status };
      out.stage_progress = {
        done: stages.filter((s) => s.status === 'completed').length,
        total: stages.length,
      };
      try {
        const engine = require('./projectStageEngine');
        if (typeof engine.computeNextAction === 'function') {
          out.next_action = await engine.computeNextAction(p.id).catch(() => null);
        }
      } catch { /* 엔진이 없어도 브리프는 나와야 한다 */ }
    }
  }

  // 미결제 청구서 — 돈 이야기가 오가는 메일에서 가장 먼저 필요한 사실이다.
  const invWhere = { business_id: businessId, status: { [Op.in]: ['sent', 'overdue', 'partially_paid'] } };
  if (thread.project_id) invWhere.project_id = thread.project_id;
  else if (thread.client_id) invWhere.client_id = thread.client_id;
  if (thread.project_id || thread.client_id) {
    const invs = await Invoice.findAll({
      where: invWhere,
      attributes: ['id', 'invoice_number', 'status', 'grand_total', 'paid_amount', 'currency', 'due_date'],
      order: [['due_date', 'ASC']], limit: 5,
    });
    out.invoices = invs.map((i) => ({
      id: i.id, number: i.invoice_number, status: i.status,
      owed: Number(i.grand_total || 0) - Number(i.paid_amount || 0),
      currency: i.currency || 'KRW', due_date: i.due_date,
    }));
  }

  // 열린 업무 — 이 메일이 어디로 이어지는지
  if (thread.project_id) {
    const tasks = await Task.findAll({
      where: {
        business_id: businessId, project_id: thread.project_id,
        status: { [Op.in]: ['not_started', 'waiting', 'in_progress', 'reviewing', 'revision_requested'] },
      },
      attributes: ['id', 'title', 'status', 'due_date'],
      order: [['due_date', 'ASC']], limit: 5,
    });
    out.tasks = tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, due_date: t.due_date }));
  }
  return out;
}

// ─── 상황 — 원장에 있는 사실만 ────────────────────────────────
function collectSituation(thread, messages, message) {
  const last = messages[messages.length - 1];
  const lastAt = last?.sent_at ? new Date(last.sent_at) : null;
  const days = lastAt ? Math.floor((Date.now() - lastAt.getTime()) / 86400000) : null;
  return {
    message_count: messages.length,
    last_direction: thread.last_message_direction || last?.direction || null,
    days_since_last: days,
    reply_needed: !!thread.reply_needed,
    reply_needed_reason: thread.reply_needed_reason || null,
    thread_status: thread.status,
    triage: thread.triage || null,
    // 이 메일이 스레드의 몇 번째인지 — "처음 온 문의" 와 "다섯 번째 재촉" 은 다른 상황이다.
    position: messages.findIndex((m) => m.id === message.id) + 1,
  };
}

/**
 * 브리프 한 건. LLM 이 안 되면 **요약만 비고 나머지는 그대로 준다** —
 * 검증·맥락은 LLM 없이 만들어지므로 AI 가 죽어도 이 기능은 죽지 않는다.
 */
async function buildBrief({ businessId, thread, language = 'ko' }) {
  const messages = await EmailMessage.findAll({
    where: { thread_id: thread.id, business_id: businessId },
    order: [['sent_at', 'ASC'], ['id', 'ASC']],
    attributes: ['id', 'direction', 'from_name', 'from_email', 'subject', 'body_text', 'body_html',
      'sent_at', 'triage_headers'],
    include: [{ association: 'attachments', required: false, attributes: ['id', 'filename'] }],
  });
  if (!messages.length) return { error: 'no_messages' };
  // 검증은 **가장 최근 수신 메일**을 대상으로 한다 — 지금 판단해야 하는 것이 그것이다.
  const target = [...messages].reverse().find((m) => m.direction === 'inbound') || messages[messages.length - 1];

  const clientRow = thread.client_id
    ? await Client.findOne({ where: { id: thread.client_id, business_id: businessId } })
    : null;

  const [trust, links] = await Promise.all([
    collectTrustSignals({ businessId, thread, message: target, clientRow }),
    collectLinks({ businessId, thread }),
  ]);
  const situation = collectSituation(thread, messages, target);

  // 요약·제안만 LLM. 사실 관계는 위에서 이미 다 만들었다.
  let summary = null;
  let suggestions = [];
  let ai_error = null;
  try {
    const threadText = messages.map((m) => {
      const who = m.direction === 'outbound' ? '우리 팀' : (m.from_name || m.from_email || '상대');
      return `${who}: ${(m.body_text || m.subject || '').replace(/\s+/g, ' ').trim().slice(0, 1500)}`;
    }).join('\n\n');
    const cueOrch = require('./cue_orchestrator');
    const out = await cueOrch.summarizeThread(businessId, {
      subject: thread.subject, threadText, language,
    });
    if (out.error) ai_error = out.error;
    else {
      const lines = String(out.content || '').split('\n').map((l) => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
      // 마지막 줄이 "다음 할 일" 성격이면 제안으로 옮긴다 — 요약과 행동을 화면에서 나눠 보여준다.
      summary = lines.slice(0, 5);
      suggestions = lines.filter((l) => /다음|해야|필요|action|next|권장/i.test(l)).slice(0, 2);
    }
  } catch (e) {
    ai_error = String(e.message || 'ai_failed').slice(0, 120);
  }

  return {
    thread_id: thread.id,
    message_id: target.id,
    summary, ai_error,
    trust, situation, links, suggestions,
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  buildBrief, collectTrustSignals, collectLinks, collectSituation,
  findLinkMismatches, readAuthResult, domainOf, RISKY_EXT,
};
