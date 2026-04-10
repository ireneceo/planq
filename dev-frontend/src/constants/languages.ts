/**
 * 지원 언어 목록 — Q Note 회의 언어 + 사용자 번역 언어 공통.
 *
 * code: ISO 639-1 (2자) — 백엔드 DB 저장 + Deepgram language 파라미터로 사용
 * label: 한국어 표시명 (사용자 인터페이스 한국어 디폴트)
 * native: 해당 언어 원어민 표기 (드롭다운 부가 정보)
 *
 * Deepgram Nova-3 지원 여부:
 *   - 'nova3' → Nova-3 단일 언어 모드 지원
 *   - 'multi' → 코드스위칭 multi 모드 (한·영 등)
 *   - false   → STT 미지원 (번역 대상으로만 사용 가능)
 */

export interface LanguageOption {
  code: string;
  label: string;
  native: string;
  deepgram: 'nova3' | 'multi' | false;
  popular?: boolean;
}

export const LANGUAGES: LanguageOption[] = [
  // ── 인기 (한국 사용자 기준) ──
  // 메인 언어를 2개 이상 선택하면 자동으로 Deepgram 코드스위칭(multi) 모드로 처리됨
  { code: 'ko', label: '한국어', native: '한국어', deepgram: 'nova3', popular: true },
  { code: 'en', label: '영어', native: 'English', deepgram: 'nova3', popular: true },
  { code: 'ja', label: '일본어', native: '日本語', deepgram: 'nova3', popular: true },
  { code: 'zh', label: '중국어 (간체)', native: '中文 (简体)', deepgram: 'nova3', popular: true },

  // ── 유럽 ──
  { code: 'es', label: '스페인어', native: 'Español', deepgram: 'nova3' },
  { code: 'fr', label: '프랑스어', native: 'Français', deepgram: 'nova3' },
  { code: 'de', label: '독일어', native: 'Deutsch', deepgram: 'nova3' },
  { code: 'it', label: '이탈리아어', native: 'Italiano', deepgram: 'nova3' },
  { code: 'pt', label: '포르투갈어', native: 'Português', deepgram: 'nova3' },
  { code: 'nl', label: '네덜란드어', native: 'Nederlands', deepgram: 'nova3' },
  { code: 'ru', label: '러시아어', native: 'Русский', deepgram: 'nova3' },
  { code: 'pl', label: '폴란드어', native: 'Polski', deepgram: 'nova3' },
  { code: 'sv', label: '스웨덴어', native: 'Svenska', deepgram: 'nova3' },
  { code: 'tr', label: '터키어', native: 'Türkçe', deepgram: 'nova3' },
  { code: 'uk', label: '우크라이나어', native: 'Українська', deepgram: 'nova3' },

  // ── 아시아 ──
  { code: 'hi', label: '힌디어', native: 'हिन्दी', deepgram: 'nova3' },
  { code: 'id', label: '인도네시아어', native: 'Bahasa Indonesia', deepgram: 'nova3' },
  { code: 'th', label: '태국어', native: 'ไทย', deepgram: 'nova3' },
  { code: 'vi', label: '베트남어', native: 'Tiếng Việt', deepgram: 'nova3' },
  { code: 'ms', label: '말레이어', native: 'Bahasa Melayu', deepgram: 'nova3' },

  // ── 중동 ──
  { code: 'ar', label: '아랍어', native: 'العربية', deepgram: 'nova3' },
  { code: 'he', label: '히브리어', native: 'עברית', deepgram: 'nova3' },
];

/** 코드로 언어 정보 lookup */
export function getLanguageByCode(code: string): LanguageOption | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

/** 브라우저 언어 → 지원 코드로 매핑 */
export function getDefaultLanguageFromBrowser(): string {
  if (typeof navigator === 'undefined') return 'ko';
  const browserLang = (navigator.language || 'ko').toLowerCase().split('-')[0];
  const found = LANGUAGES.find((l) => l.code === browserLang);
  return found ? browserLang : 'ko';
}
