// 약관·처리방침 개정 공지 — 앱 상단 띠가 **저절로** 뜨고 저절로 꺼진다 (2026-10-23, Irene «이런 건 자동화도 되어야 하는 거 아니야?»).
//
// 처리방침 제10조는 «시행 7일 전 서비스 공지(앱 상단 안내와 이 페이지)» 를 약속한다. 예전엔 배포 뒤 사람이
// 관리자 화면에 공지 글을 넣고 시행일이 지나면 지웠다 — 잊으면 약속이 깨진다. 이제 개정을 커밋하는 그 커밋에서
// 여기 한 줄을 더하면, 배포와 함께 띠가 뜨고 `effective` 다음 날 사라진다(서버·DB 쓰기 없음).
//
// ★ 문구는 i18n `common.policyNotice.<id>` (ko/en) · 링크는 `path` · 띠 껍데기는 AnnouncementBanner 한 곳.
// ★ 관리자가 넣은 운영 공지(platform.announcement_text)가 있으면 그것이 먼저다 — 한 번에 띠 하나.
// ★ 시행일을 미루면 legal.json 의 시행일·변경 이력과 여기 `effective` 를 같이 고친다.
export interface PolicyNotice {
  id: string;          // i18n 키 · 닫기 기억 키
  path: string;        // «자세히 보기» 링크
  effective: string;   // 'YYYY-MM-DD' — 이날이 지나면(다음 날 0시, 보는 사람 시간) 띠가 사라진다
}

export const POLICY_NOTICES: PolicyNotice[] = [
  { id: 'privacy_1_5', path: '/privacy', effective: '2026-11-03' },
];

/** 지금 띄울 개정 공지(가장 가까운 시행일 하나) — 없으면 null */
export function activePolicyNotice(now: Date = new Date()): PolicyNotice | null {
  const live = POLICY_NOTICES.filter((n) => {
    const [y, m, d] = n.effective.split('-').map(Number);
    return now < new Date(y, m - 1, d + 1);
  });
  live.sort((a, b) => a.effective.localeCompare(b.effective));
  return live[0] || null;
}
