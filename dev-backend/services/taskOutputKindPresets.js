// 업무 «산출물» 기본 목록 — 정본 한 곳 (docs/TASK_DELIVERABLES_DESIGN.md §7)
//
//   제품 사양(코드 상수)이다 — 운영 시드·mock 이 아니다. 처음 고를 때 그 워크스페이스 사전에 행이 생긴다(preset_key).
//   ★ key 는 한번 나가면 바꾸거나 빼지 않는다(라벨 글자만 고친다). 순서 = 고르는 목록 순서(영업 → 기획 → 디자인 → 제작 → 개발 → 보고).
//   프론트 locale 에 사본을 두지 않는다 — 화면은 API 의 labels 를 본다.
const PRESETS = [
  { key: 'proposal', ko: '제안서', en: 'Proposal' },
  { key: 'quote', ko: '견적서', en: 'Quote' },
  { key: 'contract', ko: '계약서', en: 'Contract' },
  { key: 'planning_doc', ko: '기획서', en: 'Planning document' },
  { key: 'requirements', ko: '요구사항 정의서', en: 'Requirements specification' },
  { key: 'schedule', ko: '일정표', en: 'Project schedule' },
  { key: 'research_report', ko: '조사 보고서', en: 'Research report' },
  { key: 'data_analysis', ko: '데이터 분석 자료', en: 'Data analysis' },
  { key: 'wireframe', ko: '와이어프레임', en: 'Wireframe' },
  { key: 'design_draft', ko: '디자인 시안', en: 'Design draft' },
  { key: 'final_design', ko: '최종 디자인 파일', en: 'Final design files' },
  { key: 'prototype', ko: '프로토타입', en: 'Prototype' },
  { key: 'copywriting', ko: '원고', en: 'Copy' },
  { key: 'presentation', ko: '발표 자료', en: 'Presentation deck' },
  { key: 'video', ko: '영상', en: 'Video' },
  { key: 'source_code', ko: '소스 코드', en: 'Source code' },
  { key: 'release_build', ko: '배포본', en: 'Release build' },
  { key: 'test_report', ko: '테스트 결과서', en: 'Test report' },
  { key: 'user_manual', ko: '사용 설명서', en: 'User manual' },
  { key: 'meeting_minutes', ko: '회의록', en: 'Meeting minutes' },
  { key: 'progress_report', ko: '진행 보고서', en: 'Progress report' },
  { key: 'final_report', ko: '결과 보고서', en: 'Final report' },
];

// 로드 때 스스로 확인 — 어긋나면 서버가 뜨지 않게 throw.
(function selfCheck() {
  const keys = new Set();
  const labels = new Set();
  for (const p of PRESETS) {
    if (keys.has(p.key)) throw new Error(`taskOutputKindPresets: key 중복 ${p.key}`);
    keys.add(p.key);
    for (const l of [p.ko, p.en]) {
      const n = l.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
      if (labels.has(n)) throw new Error(`taskOutputKindPresets: 라벨 중복 ${l}`);
      if (l.length > 40) throw new Error(`taskOutputKindPresets: 40자 초과 ${l}`);
      labels.add(n);
    }
  }
}());

module.exports = { PRESETS };
