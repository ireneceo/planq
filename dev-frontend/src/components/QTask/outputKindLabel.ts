// 업무 «산출물» 보이는 이름 한 곳 (docs/TASK_DELIVERABLES_DESIGN.md §6.1)
//   기본 항목 = API labels 의 보는 사람 언어(없으면 name) · 직접 입력 = name 그대로.
//   칩·셀렉트·관리 창이 전부 이 함수를 쓴다(라벨 정본은 서버 services/taskOutputKindPresets.js 한 곳).
export interface OutputKindLite {
  id: number;
  name: string;
  preset_key?: string | null;
  labels?: { ko: string; en: string } | null;
  usage_count?: number;
}

/** 아직 사전 행이 없는 기본 항목 — 고르는 순간 서버가 행을 만든다 */
export interface OutputPresetLite { key: string; labels: { ko: string; en: string } }

export function outputLang(lang: string | undefined | null): 'ko' | 'en' {
  return String(lang || '').toLowerCase().startsWith('en') ? 'en' : 'ko';
}

export function labelOf(item: { name?: string; labels?: { ko: string; en: string } | null }, lang: string | undefined | null): string {
  const l = outputLang(lang);
  return item.labels?.[l] || item.name || '';
}

/** 서버 오류 코드 → i18n 키(qtask outputs.*) — 서버 한글 문장을 그대로 띄우지 않는다 */
export function outputErrorKey(code: string | null | undefined): string | null {
  switch (code) {
    case 'too_many_output_kinds': return 'outputs.limitTask';
    case 'output_kind_limit': return 'outputs.limitWorkspace';
    case 'matches_preset': return 'outputs.matchesPreset';
    case 'duplicate_name': return 'outputs.duplicate';
    case 'name_too_long': return 'outputs.tooLong';
    default: return null;
  }
}
