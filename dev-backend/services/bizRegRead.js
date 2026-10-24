// 사업자등록증 → 사업자·증빙 칸 값 · 등록증 보관. 설계 Fable 2026-10-23(.claude/plans/qmvkq7v2c.md 판정 1~8)
//
//   Irene: *"사업자·증빙 정보를 사업자등록증 넣으면 기본적으로 내용 들어가게 못해? 이미지 보고 넣어주면 되잖아."*
//   읽기: 이미지(또는 PDF 1쪽을 그린 이미지)를 sharp 로 다시 만든다(메타데이터 제거) → 긴 변 ≤1600px 사본만 AI(OpenAI, 국외 이전)에
//     detail high 로 보낸다(등록증은 주소·업태·종목 글자가 작다). **저장하지 않는다** — 값은 확인 화면으로만 가고 사람이 보고 저장한다.
//   이미지에선 «보이는 글자만» 을 글 대조로 증명할 수 없다 — 대신 ①제목 글자에 «사업자등록» ②사업자번호 체크섬 통과
//     둘 다일 때만 채우고(found), 하나라도 아니면 **전부 비운다**(warnings 'not_biz_registration' | 'tax_id_checksum') · ③칸 길이 상한.
//     (처음엔 found = 유효 번호 ∨ 상호 였다 — 글자 없는 그림에 지어낸 상호로 found 가 됐다, Fable 2026-10-24 FAIL)
//   PDF 는 길이 하나 — 1쪽만 이미지로 그려 같은 읽기(텍스트 PDF 경로를 따로 두지 않는다). 도구(poppler)가 없으면 pdf_unsupported.
//   비용 3종 세트: 라우트 perUserDaily('bizreg-read' — 고객 정보·청구서 두 문이 같은 이름으로 나눠 쓴다) + 여기 checkUsageLimit + 크기 상한.
//   ★ 이 이미지·값을 Cue 재료·검색 색인·AI 에이전트 도구에 넣지 않는다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { callLLMImage } = require('./llm');
const { checkUsageLimit, recordUsage } = require('./cue_orchestrator');
const { normalizeJpeg, CardReadError } = require('./cardRead');
const { isValidKrBizNo, formatKrBizNo } = require('../utils/bizNo');

const SYSTEM = [
  '당신은 한국 사업자등록증(또는 사업자등록증명) 이미지에서 글자를 읽어 칸에 나누는 추출기다. 이미지에 **보이는 글자만** 옮긴다. 추측하거나 만들지 않는다.',
  '없으면 null. JSON 만 출력한다:',
  '{"title_text":string|null,"doc_type":"biz_registration"|"other","biz_name":string|null,"biz_tax_id":string|null,"biz_ceo":string|null,',
  ' "biz_type":string|null,"biz_item":string|null,"biz_address":string|null}',
  '- title_text: 문서 맨 위 제목 글자를 **보이는 그대로** 옮긴다(예: "사업자등록증"). 제목 글자가 안 보이면 null.',
  '- doc_type: 제목이 사업자등록증·사업자등록증명이면 "biz_registration", 아니면 "other". 글자가 없는 사진·다른 문서면 반드시 "other" 이고 나머지는 모두 null.',
  '- biz_name: 상호(법인명). biz_tax_id: 등록번호(000-00-00000). 법인등록번호·주민등록번호는 넣지 않는다.',
  '- biz_ceo: 대표자 성명. biz_address: 사업장 소재지(본점 소재지가 아니라 사업장).',
  '- biz_type: 업태, biz_item: 종목 — 여러 개면 쉼표로 잇는다. 칸 이름(«업태»·«종목»·«상호» 같은 머리글)은 값에 넣지 않는다.',
].join('\n');

const FIELDS = { biz_name: 200, biz_tax_id: 20, biz_ceo: 100, biz_type: 100, biz_item: 100, biz_address: 500 };
const trim = (v, max) => { if (v === null || v === undefined) return null; const s = String(v).replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; };
const LABEL_PREFIX = {
  biz_name: /^(상\s*호|법\s*인\s*명)\s*[:：]?\s*/, biz_ceo: /^(대\s*표\s*자|성\s*명)\s*[:：]?\s*/,
  biz_type: /^업\s*태\s*[:：]?\s*/, biz_item: /^종\s*목\s*[:：]?\s*/, biz_address: /^(사업장\s*)?소\s*재\s*지\s*[:：]?\s*/,
};
const MAX_SIDE = 1600;
const PDF_TIMEOUT_MS = 15000;

const isPdf = (buf, mime) => mime === 'application/pdf' || (Buffer.isBuffer(buf) && buf.slice(0, 5).toString('latin1') === '%PDF-');

/** PDF 1쪽 → PNG 버퍼. 도구 없음 = pdf_unsupported · 암호·손상 = image_unreadable */
async function pdfFirstPage(buf) {
  const { pdfToolsAvailable } = require('./pdfPagePreview');
  if (!pdfToolsAvailable()) throw new CardReadError('pdf_unsupported');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-bizreg-'));
  const src = path.join(dir, 'in.pdf');
  const prefix = path.join(dir, 'p1');
  try {
    fs.writeFileSync(src, buf);
    await new Promise((resolve, reject) => {
      execFile('pdftoppm', ['-f', '1', '-l', '1', '-scale-to', String(MAX_SIDE), '-png', '-singlefile', src, prefix],
        { timeout: PDF_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err) => (err ? reject(err) : resolve()));
    });
    return fs.readFileSync(`${prefix}.png`);
  } catch {
    throw new CardReadError('image_unreadable');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  }
}

/** 업로드(이미지·PDF) → 메타데이터 없는 JPEG(긴 변 ≤1600) */
async function toJpeg(buf, mime) {
  const raster = isPdf(buf, mime) ? await pdfFirstPage(buf) : buf;
  return normalizeJpeg(raster, MAX_SIDE);
}

/** @returns {{ values: object, found: boolean, warnings: string[] }} — 실패는 CardReadError(usage_limit 429 · ai_unavailable 503 · image_unreadable/pdf_unsupported 400) */
async function readBizRegImage(businessId, buf, mime) {
  const jpeg = await toJpeg(buf, mime);
  const usage = await checkUsageLimit(businessId);
  if (usage.over) throw new CardReadError('usage_limit', 429);
  const r = await callLLMImage({ purpose: 'bizreg_read', system: SYSTEM, text: '이 사업자등록증의 글자를 칸에 나눠 주세요.', imageJpegBuf: jpeg, json: true, detail: 'high' });
  if (r.fallback || !r.content) throw new CardReadError('ai_unavailable', 503);
  let parsed = null;
  try { parsed = JSON.parse(r.content); } catch { parsed = null; }
  // 답을 받았으면 해석이 실패해도 비용은 났다 — 기록 먼저(Fable 2026-10-24 비차단 1)
  await recordUsage(businessId, 'bizreg_read', r.model, r.input_tokens, r.output_tokens);
  if (!parsed || typeof parsed !== 'object') throw new CardReadError('ai_unavailable', 503);
  const values = {};
  for (const k of Object.keys(FIELDS)) values[k] = null;
  const empty = (w) => ({ values: Object.fromEntries(Object.keys(FIELDS).map((k) => [k, null])), found: false, warnings: [w] });
  // ★ 글자 없는 그림에도 모델이 «등록증» 이라 답하고 상호·대표·주소를 지어냈다(2026-10-24 Fable 완료 검증 FAIL — 풍경 3/3).
  //   그래서 둘 다 있어야 채운다: ①제목 글자에 «사업자등록» ②등록번호가 체크섬 통과. 하나라도 없으면 **전부 비운다** —
  //   번호만 빼고 나머지를 남기면 지어낸 상호가 그대로 폼에 들어간다(사람이 대조할 원문이 없는 값).
  const title = String(parsed.title_text || '').replace(/\s+/g, '');
  if (parsed.doc_type !== 'biz_registration' || !title.includes('사업자등록')) return empty('not_biz_registration');
  for (const [k, max] of Object.entries(FIELDS)) values[k] = trim(parsed[k], max);
  // 지시해도 머리글을 붙여 오는 일이 있다(2026-10-23 실측 «업태 정보통신업») — 맨 앞 머리글만 떼어 낸다
  for (const [k, re] of Object.entries(LABEL_PREFIX)) if (values[k]) values[k] = values[k].replace(re, '').trim() || null;
  // 틀리게 읽은(또는 지어낸) 번호면 전부 비운다 — 저장·발행이 400 을 내거나, 더 나쁘게 남의 번호·지어낸 상호로 발행된다
  if (!values.biz_tax_id || !isValidKrBizNo(values.biz_tax_id)) return empty('tax_id_checksum');
  values.biz_tax_id = formatKrBizNo(values.biz_tax_id);
  return { values, found: true, warnings: [] };
}

/** 등록증을 그 고객의 파일로 남긴다(≤1600px JPEG · 메타데이터 없음 · PDF 는 1쪽). @returns File 행 */
async function saveBizRegFile({ businessId, uploaderId, clientId, buf, mime, label }) {
  const jpeg = await toJpeg(buf, mime);
  const { uploadPathFor, ingestDownloadedFile } = require('./driveImport');
  const temp = uploadPathFor(businessId);
  fs.writeFileSync(temp, jpeg);
  const safe = String(label || 'client').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 60) || 'client';
  const out = await ingestDownloadedFile({ businessId, uploaderId }, temp, {
    fileName: `biz-registration-${safe}.jpg`, mimeType: 'image/jpeg', visibility: 'L3', securityLevel: 'general',
    private: true, auditValue: { source: 'biz_registration', client_id: clientId },
  });
  if (!out.ok) throw new CardReadError(out.reason === 'storage_quota_exceeded' ? 'storage_quota_exceeded' : 'save_failed', out.reason === 'storage_quota_exceeded' ? 422 : 500);
  await out.file.update({ client_id: clientId });
  return out.file;
}

// 두 문(고객 정보 sale · 청구서 invoices)이 같이 쓰는 업로드·한도 — 한도 이름이 같아 한 사람의 하루 몫을 나눠 쓴다
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  // 사진(래스터)·PDF 만 — svg 는 받지 않는다(Fable 2026-10-24 비차단 3)
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif|heic|heif|tiff|bmp)$/.test(file.mimetype || '') || file.mimetype === 'application/pdf'),
});
// 크기 초과(multer LIMIT_FILE_SIZE)가 next(err) 로 500 이 되지 않게 — 413 file_too_large
function uploadOne(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    const { errorResponse } = require('../middleware/errorHandler');
    if (err instanceof multer.MulterError) return errorResponse(res, err.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'image_required', err.code === 'LIMIT_FILE_SIZE' ? 413 : 400);
    return next(err);
  });
}
const { perUserDaily } = require('../middleware/costGuard');
const readLimit = perUserDaily('bizreg-read', { perMin: 5, perDay: 50, message: '사업자등록증 읽기가 너무 잦습니다. 잠시 후 다시 시도하세요.' });

/** 라우트 본문 한 벌 — 권한 체인은 부르는 라우터가 붙인다 */
async function handleRead(req, res, next) {
  const { successResponse, errorResponse } = require('../middleware/errorHandler');
  try {
    if (!req.file) return errorResponse(res, 'image_required', 400);
    const out = await readBizRegImage(Number(req.params.businessId), req.file.buffer, req.file.mimetype);
    return successResponse(res, out);
  } catch (err) {
    if (err instanceof CardReadError) return errorResponse(res, err.code, err.status);
    return next(err);
  }
}
const readMiddlewares = [...readLimit, uploadOne, handleRead];

module.exports = { readBizRegImage, saveBizRegFile, readMiddlewares, uploadOne };
