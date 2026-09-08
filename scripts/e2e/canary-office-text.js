// canary-office-text — 워드·엑셀·파워포인트를 Cue 가 **읽는가** (2026-09-08)
//
//   어제까지 `extractability` 는 텍스트·HTML·PDF 만 허용하고 나머지는 `unsupported_type`
//   이었다. 계약서·견적서·임금명세서가 대개 docx·xlsx 라, **가장 물어볼 만한 파일이
//   정확히 사각지대**였다. 오류도 안 나고 그냥 빈 문자열이라 아무도 몰랐다
//   (memory: feedback_silent_no_output_paths).
//
//   구현은 `services/officeText.js` — ZIP + XML 을 직접 읽는다(새 의존성 없음).
//
//   여기서 재는 계약 — ⑤⑥이 **음성 대조군**이다:
//     ① docx 본문이 나오고 **표의 탭·문단 줄바꿈이 살아 있다**
//        (한 번 틀렸다: `담당 ⇥ 홍길동` 이 `담당홍길동` 으로 붙어 검색이 그 줄을 못 찾았다)
//     ② xlsx 는 시트 이름 · 공유문자열 · inlineStr 을 읽고,
//        **날짜 일련번호를 날짜로 되돌린다** (`46023` 이 그대로 나가면 숫자만 옳고 뜻은 틀린 답이 된다)
//     ③ pptx 는 슬라이드별로 읽는다
//     ④ 색인까지 붙어 **본문에만 있는 낱말**로 검색된다 (= Cue 가 내용으로 답할 수 있다)
//     ⑤ 옛 바이너리 .doc/.xls 은 여전히 못 읽는다 (ZIP 이 아니다 — 읽는 척하면 그게 더 나쁘다)
//     ⑥ 암호 걸린/손상된 파일에 **예외를 던지지 않는다** (색인이 업로드를 죽이면 안 된다)
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const fs = require('fs');
const path = require('path');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const { File } = require('/opt/planq/dev-backend/models');
const { extractOfficeText } = require('/opt/planq/dev-backend/services/officeText');
const { extractability, extractFileText } = require('/opt/planq/dev-backend/services/fileText');
const fileIndex = require('/opt/planq/dev-backend/services/fileIndex');
const kbService = require('/opt/planq/dev-backend/services/kb_service');

const FIX = path.join(__dirname, 'fixtures');
const BIZ = 5;
const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

async function seed(kind, name) {
  const dir = path.join('/opt/planq/dev-backend/uploads', String(BIZ), 'canary');
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, name);
  fs.copyFileSync(path.join(FIX, `office-canary.${kind}`), abs);
  const f = await File.create({
    business_id: BIZ, file_name: name, file_path: abs,
    file_size: fs.statSync(abs).size, mime_type: MIME[kind],
    storage_provider: 'planq', uploader_id: 5, vlevel: 'L3', security_level: 'general',
  });
  return { file: f, abs };
}

async function run() {
  const results = [];
  const push = (n, ok, m) => results.push({ name: n, fail: ok ? 0 : 1, details: [m] });
  const made = [];
  try {
    const stamp = Date.now();

    // ① docx
    const docx = extractOfficeText(fs.readFileSync(path.join(FIX, 'office-canary.docx')), 'docx');
    push('① docx 본문 — 표의 탭·문단 줄바꿈이 살아 있다',
      docx.includes('계약 금액은 12,500,000 원') && docx.includes('담당\t홍길동\n연락') && docx.includes('오피스카나리각주'),
      `len=${docx.length} · 탭보존=${docx.includes('담당\t홍길동')} · 각주=${docx.includes('오피스카나리각주')}`);

    // ② xlsx
    const xlsx = extractOfficeText(fs.readFileSync(path.join(FIX, 'office-canary.xlsx')), 'xlsx');
    push('② xlsx — 시트 이름 · 공유문자열 · inlineStr · **날짜 일련번호를 날짜로**',
      xlsx.includes('# 견적') && xlsx.includes('# 비고') && xlsx.includes('오피스카나리엑셀')
        && xlsx.includes('2026-01-01') && !xlsx.includes('46023')
        && xlsx.includes('인라인항목') && xlsx.includes('줄바꿈이어짐'),
      `날짜변환=${xlsx.includes('2026-01-01')} · 원시일련번호남음=${xlsx.includes('46023')} · ${JSON.stringify(xlsx.slice(0, 70))}`);

    // ③ pptx
    const pptx = extractOfficeText(fs.readFileSync(path.join(FIX, 'office-canary.pptx')), 'pptx');
    push('③ pptx — 슬라이드별로 읽는다',
      pptx.includes('# Slide 1') && pptx.includes('오피스카나리피피티') && pptx.includes('# Slide 2'),
      `len=${pptx.length} · ${JSON.stringify(pptx.slice(0, 60))}`);

    // ⑤ 음성 대조군 — 옛 바이너리는 못 읽는다고 말해야 한다
    const legacyDoc = extractability({ file_path: '/x/a.doc', mime_type: 'application/msword', file_name: 'a.doc' });
    const legacyXls = extractability({ file_path: '/x/a.xls', mime_type: 'application/vnd.ms-excel', file_name: 'a.xls' });
    push('⑤ 옛 바이너리 .doc/.xls 은 여전히 unsupported_type',
      legacyDoc.ok === false && legacyDoc.reason === 'unsupported_type'
        && legacyXls.ok === false && legacyXls.reason === 'unsupported_type',
      `${JSON.stringify(legacyDoc)} / ${JSON.stringify(legacyXls)}`);

    // ⑥ 음성 대조군 — 암호(OLE 컨테이너)·손상 파일에 예외를 던지지 않는다
    let threw = null;
    try {
      const ole = extractOfficeText(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0, 0, 0]), 'docx');
      const broken = extractOfficeText(Buffer.concat([Buffer.from('PK'), Buffer.alloc(200)]), 'xlsx');
      const empty = extractOfficeText(Buffer.alloc(0), 'pptx');
      threw = (ole === '' && broken === '' && empty === '') ? null : `빈 문자열이 아니다: ${[ole, broken, empty].map((v) => v.length)}`;
    } catch (e) { threw = `예외를 던졌다: ${e.message}`; }
    push('⑥ 암호·손상 파일은 예외 없이 빈 문자열', threw === null, threw || '예외 0 · 전부 0자');

    // ④ 색인 → 본문에만 있는 낱말로 검색 (= Cue 가 내용으로 답한다)
    const seeded = await seed('docx', `office-canary-${stamp}.docx`);
    made.push(seeded);
    const viaFileText = await extractFileText(seeded.file, { maxChars: 5000 });
    push('④-a File 레코드 경로로도 같은 본문이 나온다',
      viaFileText.includes('오피스카나리도큐'),
      `len=${viaFileText.length}`);
    const idx = await fileIndex.indexFile(seeded.file.id);
    await kbService.indexDocument(idx.doc_id).catch(() => {});
    const hit = await kbService.hybridSearch(BIZ, '오피스카나리도큐', { limit: 5 });
    const fromFile = (hit.kb_chunks || []).filter((c) => c.source_type === 'file' && c.document_id === idx.doc_id);
    push('④-b 이름이 아니라 **워드 본문 안의 낱말**로 검색된다',
      idx.indexed === true && fromFile.length > 0,
      `${JSON.stringify(idx)} · 청크 ${(hit.kb_chunks || []).length}건 중 이 파일 ${fromFile.length}건`);
  } catch (e) {
    push('카나리 실행', false, String((e && e.message) || e));
  } finally {
    for (const m of made) {
      try {
        await fileIndex.removeFileIndex(m.file.id, m.file.business_id);
        await m.file.destroy({ force: true });
        fs.unlinkSync(m.abs);
      } catch { /* 이미 정리됨 */ }
    }
  }
  return results;
}

module.exports = { run };
