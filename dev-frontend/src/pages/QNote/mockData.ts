/**
 * Q Note Mock 데이터 — UI 검토용 (B-3 단계).
 * 백엔드 연결 시 이 파일은 제거하고 실 API로 교체.
 *
 * 시나리오: 한국 사용자가 영어 미팅을 듣고 한국어 번역으로 이해.
 * 회의 메인 언어 = 영어(en), 사용자 모국어 = 한국어(ko).
 */

export interface MockUtterance {
  id: number;
  speaker: string;
  original: string;     // 회의 메인 언어 그대로 (영어)
  translation: string;  // 사용자 모국어로 번역 (한국어)
  timestamp: string;
  isQuestion: boolean;
  isSelf?: boolean;     // 본인 발화. true면 isQuestion=true여도 답변 찾기 UI 표시 안 함.
}

export interface MockSession {
  id: number;
  title: string;
  date: string;
  duration: string;
  utteranceCount: number;
  language: string;
  status: 'completed' | 'recording';
}

export const MOCK_SESSIONS: MockSession[] = [
  {
    id: 1,
    title: 'Weekly Product Sync (Eng team)',
    date: '2026-04-10',
    duration: '23:45',
    utteranceCount: 47,
    language: 'en',
    status: 'completed',
  },
  {
    id: 2,
    title: 'Coursera — System Design Lecture 5',
    date: '2026-04-09',
    duration: '1:12:30',
    utteranceCount: 152,
    language: 'en',
    status: 'completed',
  },
  {
    id: 3,
    title: '클라이언트 컨설팅 — 신규 프로젝트 킥오프',
    date: '2026-04-09',
    duration: '45:20',
    utteranceCount: 89,
    language: 'ko',
    status: 'completed',
  },
  {
    id: 4,
    title: 'Investor Update Call',
    date: '2026-04-08',
    duration: '38:15',
    utteranceCount: 71,
    language: 'en',
    status: 'completed',
  },
];

// 영어 회의 + 한국어 번역 (Irene의 실제 use case).
// translation이 빈 문자열이면 → 발화 언어가 사용자 모국어와 같음 (번역 생략).
export const MOCK_LIVE_UTTERANCES: MockUtterance[] = [
  {
    id: 0,
    speaker: '나',
    original: '오늘 회의에 늦어서 죄송해요. 어디서부터 시작하셨죠?',
    translation: '', // 한국어 발화 + 사용자 모국어 한국어 → 번역 생략
    timestamp: '00:00',
    isQuestion: true,
    isSelf: true, // 본인 질문 → 답변 찾기 UI 표시 안 함
  },
  {
    id: 1,
    speaker: 'Sarah',
    original: "Good morning everyone. Let's get started with our weekly sync.",
    translation: '모두 좋은 아침이에요. 주간 싱크 시작하겠습니다.',
    timestamp: '00:03',
    isQuestion: false,
  },
  {
    id: 2,
    speaker: 'Michael',
    original: 'Before we begin, can someone share the agenda for today?',
    translation: '시작하기 전에, 오늘 안건을 공유해주실 분 계신가요?',
    timestamp: '00:08',
    isQuestion: true,
  },
  {
    id: 3,
    speaker: 'Sarah',
    original:
      "Sure. Three items today: launch retrospective, Q3 roadmap review, and the new onboarding flow. Let's start with the retro.",
    translation:
      '네. 오늘 안건 3개입니다: 런칭 회고, Q3 로드맵 리뷰, 새 온보딩 플로우. 회고부터 시작할게요.',
    timestamp: '00:15',
    isQuestion: false,
  },
  {
    id: 4,
    speaker: 'Michael',
    original:
      'The launch went well overall, but we saw a 12% drop-off at the email verification step. Any thoughts on why?',
    translation:
      '런칭은 전반적으로 잘 됐는데, 이메일 인증 단계에서 12% 이탈이 발생했어요. 원인 짚이는 거 있나요?',
    timestamp: '00:30',
    isQuestion: true,
  },
  {
    id: 5,
    speaker: 'Sarah',
    original:
      'I think the verification email might be landing in spam folders for some providers. We should run a deliverability test this week.',
    translation:
      '일부 제공자에서 인증 메일이 스팸으로 가는 것 같아요. 이번 주에 전송률 테스트 돌려봐야 할 것 같습니다.',
    timestamp: '00:42',
    isQuestion: false,
  },
  {
    id: 6,
    speaker: 'Michael',
    original: 'Good idea. Who can own that test?',
    translation: '좋은 생각이에요. 그 테스트는 누가 맡으실까요?',
    timestamp: '00:50',
    isQuestion: true,
  },
  {
    id: 7,
    speaker: 'Sarah',
    original: "I'll take it. I'll have results by Friday.",
    translation: '제가 맡을게요. 금요일까지 결과 정리해드리겠습니다.',
    timestamp: '00:55',
    isQuestion: false,
  },
];
