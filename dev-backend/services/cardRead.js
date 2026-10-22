// 명함 사진 → 칸 값 · 명함 사진 보관. 설계 docs/NAME_CARD_V3_STRATEGY.md 9절 결정 3 (Fable 2026-10-22)
//
//   읽기: 받은 사진을 sharp 로 다시 만든다(메타데이터 제거 — 위치정보가 목적) → ≤1024px 사본만 AI(OpenAI, 국외 이전)에 보낸다.
//     **저장하지 않는다** — 값은 확인 화면(고객 추가 폼)에만 채운다. 사람이 보고 저장한다.
//   보관: 저장을 누른 뒤에만 ≤1600px JPEG 를 그 고객의 파일(File, client_id)로 남긴다 — 쿼터·중복 제거·휴지통은
//     driveImport.ingestDownloadedFile 한 벌(자체 업로드와 같은 규칙). 멤버 공개(L3)·보안등급 일반·색인/방송 없음(private).
//   비용 3종 세트(CLAUDE.md 운영 1번): 라우트 perUserDaily + 여기 checkUsageLimit + 입력 상한(이미지 크기·글자).
//   ★ 이 사진·값을 Cue 재료·검색 색인·AI 에이전트 도구에 넣지 않는다.
const fs = require('fs');
const { callLLMImage } = require('./llm');
const { checkUsageLimit, recordUsage } = require('./cue_orchestrator');

const SYSTEM = [
  '당신은 명함 사진에서 글자를 읽어 칸에 나누는 추출기다. 사진에 **보이는 글자만** 옮긴다. 추측하거나 만들지 않는다.',
  '없으면 null. JSON 만 출력한다:',
  '{"name":string|null,"name_en":string|null,"company":string|null,"job_title":string|null,"department":string|null,',
  ' "email":string|null,"mobile":string|null,"phone":string|null,"fax":string|null,"address":string|null,"website":string|null}',
  '- name: 사람 이름(한글 이름이 있으면 그것). name_en: 영문 이름이 따로 있으면.',
  '- company: 회사·기관명(로고 글자 포함). job_title: 직함·직책. department: 부서·팀.',
  '- mobile: 휴대폰(010 등, M/Mobile 표시). phone: 대표·사무실 전화(T/Tel). fax: F/Fax. 숫자·하이픈·+ 만 남긴다.',
  '- 명함이 아니거나 글자를 못 읽으면 모든 값을 null 로.',
].join('\n');

const FIELDS = { name: 100, name_en: 100, company: 200, job_title: 100, department: 100, email: 200, mobile: 40, phone: 40, fax: 40, address: 300, website: 300 };
const trim = (v, max) => { if (v === null || v === undefined) return null; const s = String(v).replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; };

class CardReadError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

/** 업로드 바이트 → 메타데이터 없는 JPEG(긴 변 ≤ max). 이미지가 아니면 image_unreadable */
async function normalizeJpeg(buf, max) {
  const sharp = require('sharp');
  try {
    return await sharp(buf, { failOn: 'error' }).rotate().resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  } catch { throw new CardReadError('image_unreadable'); }
}

/** @returns {{ values: object, found: boolean }} — 실패는 CardReadError(usage_limit 429 · ai_unavailable 503 · image_unreadable 400) */
async function readCardImage(businessId, buf) {
  const small = await normalizeJpeg(buf, 1024);
  const usage = await checkUsageLimit(businessId);
  if (usage.over) throw new CardReadError('usage_limit', 429);
  const r = await callLLMImage({ purpose: 'card_read', system: SYSTEM, text: '이 명함의 글자를 칸에 나눠 주세요.', imageJpegBuf: small, json: true });
  if (r.fallback || !r.content) throw new CardReadError('ai_unavailable', 503);
  let parsed = null;
  try { parsed = JSON.parse(r.content); } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object') throw new CardReadError('ai_unavailable', 503);
  await recordUsage(businessId, 'card_read', r.model, r.input_tokens, r.output_tokens);
  const values = {};
  for (const [k, max] of Object.entries(FIELDS)) values[k] = trim(parsed[k], max);
  if (values.email) {
    values.email = values.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) values.email = null;   // 저장이 400 낼 값을 폼에 채우지 않는다
  }
  const found = ['name', 'company', 'email', 'mobile', 'phone'].some((k) => values[k]);
  return { values, found };
}

/** 명함 사진을 그 고객의 파일로 남긴다(≤1600px · 메타데이터 없음). @returns File 행 */
async function saveCardPhoto({ businessId, uploaderId, clientId, buf, label }) {
  const jpeg = await normalizeJpeg(buf, 1600);
  const { uploadPathFor, ingestDownloadedFile } = require('./driveImport');
  const temp = uploadPathFor(businessId);
  fs.writeFileSync(temp, jpeg);
  const safe = String(label || 'card').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 60) || 'card';
  const out = await ingestDownloadedFile({ businessId, uploaderId }, temp, {
    fileName: `card-${safe}.jpg`, mimeType: 'image/jpeg', visibility: 'L3', securityLevel: 'general',
    private: true, auditValue: { source: 'name_card_photo', client_id: clientId },
  });
  if (!out.ok) throw new CardReadError(out.reason === 'storage_quota_exceeded' ? 'storage_quota_exceeded' : 'save_failed', out.reason === 'storage_quota_exceeded' ? 422 : 500);
  await out.file.update({ client_id: clientId });
  return out.file;
}

// ─── 메일 서명 읽기 (2026-10-22) ─────────────────────────────────
//   Irene: *"메일에서 고객을 추가하거나 초대할 수 있게 하면, 기본 정보를 메일 서명 같은 곳에서 가져와야 해"*
//   서명은 «글로 된 명함» 이다 — 칸(FIELDS)·정리(trim)·이메일 검사가 명함 사진과 같다. **저장하지 않는다**.
//   보낸 사람 주소는 요청한 주소로 고정한다(서명 속 다른 주소로 바꾸지 않는다 — 다른 사람 주소일 수 있다).
const SIG_SYSTEM = [
  '당신은 이메일 끝의 서명 글에서 보낸 사람의 연락처를 칸에 나누는 추출기다. 글에 **있는 것만** 옮긴다. 추측하거나 만들지 않는다.',
  '서명이 아닌 본문 문장(인사·요청 내용)은 무시한다. 없으면 null. JSON 만 출력한다:',
  '{"name":string|null,"name_en":string|null,"company":string|null,"job_title":string|null,"department":string|null,',
  ' "mobile":string|null,"phone":string|null,"fax":string|null,"address":string|null,"website":string|null}',
  '- name: 보낸 사람 이름(존칭·직함 제외). «보낸 사람 표시 이름» 이 주어지면 참고하되 서명에 더 정확한 이름이 있으면 그것.',
  '- company: 회사·기관명. 이메일 도메인으로 **추측하지 않는다**. job_title: 직함·직책. department: 부서·팀.',
  '- mobile: 휴대폰(010 등, M/Mobile/HP). phone: 사무실·대표 전화(T/Tel). fax: F/Fax. 숫자·하이픈·+ 만 남긴다.',
].join('\n');

/** @returns {{ values: object, found: boolean }} — 실패는 CardReadError(usage_limit 429 · ai_unavailable 503) */
async function readSignatureText(businessId, { text, fromName, fromEmail }) {
  const body = String(text || '').trim();
  const email = String(fromEmail || '').trim().toLowerCase();
  const values = {};
  for (const k of Object.keys(FIELDS)) values[k] = null;
  values.email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  // 서명이 없으면 AI 를 부르지 않는다(비용) — 표시 이름만 돌려준다
  if (!body) {
    values.name = trim(fromName, FIELDS.name);
    return { values, found: false };
  }
  const usage = await checkUsageLimit(businessId);
  if (usage.over) throw new CardReadError('usage_limit', 429);
  const { callLLM } = require('./llm');
  const user = `보낸 사람 표시 이름: ${String(fromName || '').slice(0, 100) || '(없음)'}\n보낸 사람 주소: ${email || '(없음)'}\n\n메일 끝부분:\n${body}`;
  const r = await callLLM({
    purpose: 'card_read', json: true, fallback: '',
    messages: [{ role: 'system', content: SIG_SYSTEM }, { role: 'user', content: user }],
  });
  if (r.fallback || !r.content) throw new CardReadError('ai_unavailable', 503);
  let parsed = null;
  try { parsed = JSON.parse(r.content); } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object') throw new CardReadError('ai_unavailable', 503);
  await recordUsage(businessId, 'card_read', r.model, r.input_tokens, r.output_tokens);
  // ★ 글에 **실제로 있는** 값만 남긴다 — 지시해도 모델이 도메인(test.planq.kr)을 회사명으로 지어냈다(2026-10-22 실측).
  //   전화는 숫자만 비교한다. 이름은 표시 이름에서도 올 수 있어 서명 글 + 표시 이름에서 찾는다.
  const norm = (x) => String(x || '').replace(/\s+/g, ' ').toLowerCase();
  const bodyHay = norm(body);
  const nameHay = `${bodyHay}\n${norm(fromName)}`;
  const digits = body.replace(/\D/g, '');
  const grounded = (k, v) => {
    if (!v) return null;
    if (['mobile', 'phone', 'fax'].includes(k)) {
      const d = v.replace(/\D/g, '');
      return d.length >= 7 && digits.includes(d) ? v : null;
    }
    return (k === 'name' || k === 'name_en' ? nameHay : bodyHay).includes(norm(v)) ? v : null;
  };
  for (const [k, max] of Object.entries(FIELDS)) if (k !== 'email') values[k] = grounded(k, trim(parsed[k], max));
  if (!values.name) values.name = trim(fromName, FIELDS.name);
  const found = ['company', 'job_title', 'department', 'mobile', 'phone'].some((k) => values[k]);
  return { values, found };
}

module.exports = { readSignatureText, readCardImage, saveCardPhoto, normalizeJpeg, CardReadError };
