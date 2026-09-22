// 서명본 = **고정본 + 서명** — 한 곳에서 조립한다 (2026-09-22).
//
// Irene: *"문서에 서명이 어떻게 나오는지 알 수 없어서"* — 여태 서명은 signature_requests 에만 있었고
//   문서·공유 링크·PDF 어디에도 나오지 않았다. 설계 docs/SIGNATURE_FIELD_DESIGN.md
//
// 계약:
//   · **고정본이 원본이다.** 서명 요청 때 얼어붙은 내용(snapshot_content_json)에 서명을 끼운다.
//     요청 뒤 원본 문서를 고쳐도 서명본은 바뀌지 않는다 — 계약서의 기본이다.
//   · 조립은 **여기 한 함수**뿐이다. 화면·공유 페이지·PDF 가 각자 끼우면 세 곳이 갈라진다
//     (memory feedback_same_value_multiple_formulas).
//   · 서명란이 **없는** 문서는 문서 끝에 서명 영역을 붙인다 — 옛 요청(slot NULL)도 그렇게 보인다.
//   · 서명 이미지는 data URL 그대로 넣는다(PDF 는 오프라인 렌더라 외부 주소를 못 가져온다).
// pdfTemplates 는 escapeHtml 을 내보내지 않는다(내부 함수). 같은 규칙을 여기에 둔다 — 두 줄짜리라
//   순환 require 를 만들면서까지 공유할 이유가 없다.
const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FIELD_RE = /<div data-signature-field(?:[^>]*)><\/div>/g;
const attrOf = (tag, name) => {
  const m = new RegExp(`data-${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};

function fmt(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 한 칸의 표시 — 서명 전이면 빈 칸, 서명 후면 이미지·이름·일시. 라벨은 문서에 적힌 것 우선. */
function fieldHtml(label, party, sr, L, slot) {
  const name = sr ? (sr.signer_name || sr.signer_email || '') : '';
  const cap = escapeHtml(label || (party === 'us' ? L.us : L.them));
  // ★ 칸 번호·구분을 결과에도 싣는다 — 서명 화면이 «내 칸» 을 이걸로 찾아 강조한다.
  //   빼면 서명자가 자기 서명이 어디에 들어가는지 모른 채 서명한다(설계 §1의 출발점).
  const idAttr = `${slot != null ? ` data-slot="${escapeHtml(String(slot))}"` : ''} data-party="${party === 'us' ? 'us' : 'them'}"`;
  // ★ 2026-09-22 — **거절을 «서명 전» 으로 그리지 않는다.** 고객이 거절했는데 문서·PDF·공유 링크에는
  //   아직 안 한 것과 똑같이 보였다(실측). 보내는 사람은 그 PDF 를 그대로 남에게 보낸다 —
  //   «아직 기다리는 중» 과 «거부당했다» 는 계약에서 완전히 다른 사실이다.
  //   사유는 싣지 않는다(공개 링크에도 나가는 자리라, 사실만 적고 사유는 진행 표·증명서 쪽에 둔다).
  if (sr && sr.status === 'rejected') {
    return `<div class="pq-sig pq-sig-rejected"${idAttr}>`
      + `<div class="pq-sig-cap">${cap}</div>`
      + `<div class="pq-sig-no">${escapeHtml(L.rejected)}</div>`
      + `<div class="pq-sig-meta">${escapeHtml(name)}${sr.rejected_at ? ` · ${escapeHtml(fmt(sr.rejected_at))}` : ''}</div>`
      + `</div>`;
  }
  if (!sr || sr.status !== 'signed') {
    return `<div class="pq-sig"${idAttr}>${`<div class="pq-sig-cap">${cap}</div>`}<div class="pq-sig-empty">${escapeHtml(L.empty)}</div></div>`;
  }
  const img = sr.signature_image_b64 && /^data:image\//i.test(sr.signature_image_b64)
    ? `<img class="pq-sig-img" src="${escapeHtml(sr.signature_image_b64)}" alt="" />` : '';
  return `<div class="pq-sig pq-sig-done"${idAttr}>`
    + `<div class="pq-sig-cap">${cap}</div>`
    + img
    + `<div class="pq-sig-meta">${escapeHtml(name)}${sr.signed_at ? ` · ${escapeHtml(fmt(sr.signed_at))}` : ''}</div>`
    + `<div class="pq-sig-badge">${escapeHtml(L.verified)}</div>`
    + `</div>`;
}

const SIGNED_CSS = `
.pq-sig { border: 1px solid #CBD5E1; border-radius: 8px; padding: 10px 12px; margin: 10px 0; min-height: 64px; }
.pq-sig-cap { font-size: 11px; font-weight: 700; color: #64748B; margin-bottom: 4px; }
.pq-sig-empty { color: #94A3B8; font-size: 12px; border-bottom: 1px dashed #CBD5E1; padding-bottom: 14px; }
.pq-sig-done { border-color: #14B8A6; background: #F0FDFA; }
.pq-sig-img { display: block; max-height: 64px; max-width: 220px; }
.pq-sig-meta { font-size: 12px; color: #334155; margin-top: 4px; }
.pq-sig-badge { font-size: 10px; color: #0F766E; margin-top: 2px; }
.pq-sig-rejected { border-color: #FCA5A5; background: #FEF2F2; }
.pq-sig-no { color: #B91C1C; font-size: 12px; font-weight: 700; padding: 6px 0; }
`;

/**
 * 고정본 HTML + 서명 → 서명본 HTML.
 * @param {string} html    고정본을 그린 HTML (pdfTemplates.richBodyToHtml 결과)
 * @param {Array}  reqs    SignatureRequest 들 (같은 문서의 sign 요청)
 * @param {object} labels  화면 문구 (서버 문자열이라 i18n 가드 밖 — 호출부가 언어를 고른다)
 */
function injectSignatures(html, reqs, labels) {
  const L = { us: '보내는 쪽', them: '받는 쪽', empty: '서명 전', verified: '전자서명 확인됨', ...(labels || {}) };
  const signs = (reqs || []).filter((r) => r.kind !== 'confirm');
  const bySlot = new Map();
  for (const r of signs) if (r.slot != null) bySlot.set(Number(r.slot), r);
  const used = new Set();
  let out = String(html || '').replace(FIELD_RE, (tag) => {
    const slot = Number(attrOf(tag, 'slot') || 1);
    const party = attrOf(tag, 'party') === 'us' ? 'us' : 'them';
    const sr = bySlot.get(slot) || null;
    if (sr) used.add(sr.id);
    return fieldHtml(attrOf(tag, 'label'), party, sr, L, slot);
  });
  // 서명란에 못 붙은 서명(옛 요청 · 칸보다 서명자가 많음)은 문서 끝 서명 영역으로 — 조용히 사라지지 않게
  const rest = signs.filter((r) => !used.has(r.id));
  if (rest.length) {
    out += `<div class="pq-sig-zone">${rest.map((r) => fieldHtml(null, r.party === 'us' ? 'us' : 'them', r, L, r.slot)).join('')}</div>`;
  }
  return out;
}

/** 증명서 — 서명본 마지막 장. «무엇에 누가 언제 서명했는가» 를 한 장으로. */
function certificateHtml(doc, reqs, labels) {
  const L = {
    title: '전자서명 증명서', docTitle: '문서', hash: '문서 지문(SHA-256)', signer: '서명자',
    email: '이메일', verifiedAt: '본인 확인', signedAt: '서명 시각', ip: 'IP', side: '구분',
    us: '보내는 쪽', them: '받는 쪽', none: '—', ...(labels || {}),
  };
  const signs = (reqs || []).filter((r) => r.kind !== 'confirm' && r.status === 'signed');
  if (!signs.length) return '';
  const rows = signs.map((r) => `<tr>`
    + `<td>${escapeHtml(r.signer_name || r.signer_email || '')}</td>`
    + `<td>${escapeHtml(r.signer_email || '')}</td>`
    + `<td>${escapeHtml(r.party === 'us' ? L.us : L.them)}</td>`
    + `<td>${escapeHtml(r.otp_verified_at ? fmt(r.otp_verified_at) : L.none)}</td>`
    + `<td>${escapeHtml(fmt(r.signed_at))}</td>`
    + `<td>${escapeHtml(r.signed_ip || L.none)}</td></tr>`).join('');
  // 지문은 요청 생성 때 이미 찍힌 content_hash (제목+본문 SHA-256, signatureCore.buildEntitySnapshot 단일 공식)
  const hash = signs.find((r) => r.content_hash)?.content_hash || null;
  return `<div class="pq-cert">`
    + `<h2>${escapeHtml(L.title)}</h2>`
    + `<div class="pq-cert-meta">${escapeHtml(L.docTitle)}: ${escapeHtml(doc && doc.title ? doc.title : '')}</div>`
    + (hash ? `<div class="pq-cert-meta">${escapeHtml(L.hash)}: <code>${escapeHtml(hash)}</code></div>` : '')
    + `<table class="pq-cert-table"><thead><tr>`
    + `<th>${escapeHtml(L.signer)}</th><th>${escapeHtml(L.email)}</th><th>${escapeHtml(L.side)}</th>`
    + `<th>${escapeHtml(L.verifiedAt)}</th><th>${escapeHtml(L.signedAt)}</th><th>${escapeHtml(L.ip)}</th>`
    + `</tr></thead><tbody>${rows}</tbody></table></div>`;
}

const CERT_CSS = `
.pq-cert { page-break-before: always; margin-top: 24px; border-top: 2px solid #0F766E; padding-top: 16px; }
.pq-cert h2 { font-size: 15px; margin: 0 0 8px; }
.pq-cert-meta { font-size: 11px; color: #475569; margin-bottom: 4px; word-break: break-all; }
.pq-cert-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
.pq-cert-table th, .pq-cert-table td { border: 1px solid #E2E8F0; padding: 6px 8px; text-align: left; }
.pq-cert-table th { background: #F8FAFC; color: #334155; }
`;

// 서명본 문구 — **서버가 만드는 문자열**이라 프론트 i18n 밖이다
//   (memory feedback_backend_strings_outside_i18n_guard). 언어는 부르는 쪽이 고른다.
const LABELS = {
  ko: {
    us: '보내는 쪽', them: '받는 쪽', empty: '서명 전', verified: '전자서명 확인됨', rejected: '서명 거절',
    title: '전자서명 증명서', docTitle: '문서', hash: '문서 지문(SHA-256)', signer: '서명자',
    email: '이메일', verifiedAt: '본인 확인', signedAt: '서명 시각', ip: 'IP', side: '구분', none: '—',
  },
  en: {
    us: 'Sender', them: 'Recipient', empty: 'Not signed', verified: 'e-signature verified', rejected: 'Declined',
    title: 'E-signature certificate', docTitle: 'Document', hash: 'Document fingerprint (SHA-256)',
    signer: 'Signer', email: 'Email', verifiedAt: 'Identity verified', signedAt: 'Signed at',
    ip: 'IP', side: 'Party', none: '—',
  },
};
/** 요청 헤더에서 언어를 고른다 — 한국어가 기본(제품 기본 언어). */
function labelsFor(req) {
  const al = String(req?.headers?.['accept-language'] || '').toLowerCase();
  return al && !al.startsWith('ko') && al.startsWith('en') ? LABELS.en : LABELS.ko;
}

/**
 * 한 문서의 «서명본» 재료를 모은다 — **여기 한 곳**에서 모은다.
 * 화면·공유 링크·PDF 가 각자 SignatureRequest 를 긁으면 조건(취소 제외·정렬·고정본 선택)이 갈라진다.
 *
 * @returns {{requests, frozen:{title,content_json}|null, total:number, signed:number, complete:boolean}}
 */
async function loadSignedView(entity_type, entity_id) {
  const { SignatureRequest } = require('../models');
  const { Op } = require('sequelize');
  const requests = await SignatureRequest.findAll({
    where: {
      entity_type, entity_id, kind: 'sign',
      status: { [Op.notIn]: ['canceled'] },   // 취소된 요청은 문서에 자리를 차지하지 않는다
    },
    // 칸 번호 순 → 같은 칸이면 만든 순. slot NULL 은 뒤로(옛 요청은 문서 끝 영역)
    order: [[require('../config/database').sequelize.literal('`slot` IS NULL'), 'ASC'], ['slot', 'ASC'], ['id', 'ASC']],
  });
  // 고정본은 **이 서명 라운드가 시작될 때의 문서** — 가장 먼저 만든 요청의 동결분.
  //   요청 뒤에 원본을 고쳐도 서명본은 바뀌지 않는다(계약서의 기본. 설계 §2).
  const base = requests.slice().sort((a, b) => a.id - b.id).find((r) => r.content_snapshot);
  const frozen = base ? { title: base.title_snapshot, content_json: base.content_snapshot } : null;
  const signed = requests.filter((r) => r.status === 'signed').length;
  return { requests, frozen, total: requests.length, signed, complete: requests.length > 0 && signed === requests.length };
}

module.exports = { injectSignatures, certificateHtml, loadSignedView, labelsFor, LABELS, SIGNED_CSS, CERT_CSS, fieldHtml };
