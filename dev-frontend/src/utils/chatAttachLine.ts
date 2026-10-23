import type { TFunction } from 'i18next';

// 첨부만 보낸 채팅 메시지의 한 줄 — «이미지가 첨부되었습니다» / «파일 3개가 첨부되었습니다».
//   서버 알림 본문(dev-backend/services/outsidePreview.attachmentBody)과 같은 문구. 힌트가 없으면(옛 번들) 파일 한 개로 말한다.
//   Irene 2026-10-23: «PlanQ에서 확인하세요 … 뭘 확인하라는 건지 인지가 안되니 나쁜 멘트».
export function chatAttachLine(t: TFunction, h?: { kind: 'image' | 'file'; count: number }): string {
  const n = Math.max(1, Math.min(50, Math.floor(Number(h?.count)) || 1));
  const img = h?.kind === 'image';
  if (n === 1) return (img ? t('toaster.attachImage', '이미지가 첨부되었습니다') : t('toaster.attachFile', '파일이 첨부되었습니다')) as string;
  return (img
    ? t('toaster.attachImages', { n, defaultValue: '이미지 {{n}}개가 첨부되었습니다' })
    : t('toaster.attachFiles', { n, defaultValue: '파일 {{n}}개가 첨부되었습니다' })) as string;
}
