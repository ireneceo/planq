// 상담 예약(창구 P2)이 캘린더 칸에서 **어떻게 보이는가** — 한 벌 (docs/CLIENT_ENTRY_DESIGN.md §4.5)
//
//   신청·제안(아직 안 정해짐) → **점선 테두리 + «신청» 표시** · 확정 → 보통 일정과 같음 ·
//   거절·취소 → 흐리게 + 취소선.
// ★ 월간 칸·월간 팝오버·종일·시간표·목록 **다섯 곳**이 같은 조각을 쓴다. 한 곳에 손으로 적으면
//   보기를 바꿀 때 신청이 확정처럼 보이는 칸이 생긴다(같은 값의 공식 두 벌).
import styled, { css } from 'styled-components';
import { useTranslation } from 'react-i18next';

type WithBooking = { booking_status?: string | null };

/** data-booking 값 — styled 의 bookingCss 가 이것으로 가른다. 보통 일정이면 undefined(속성 없음). */
export function bookingAttr(e: WithBooking): 'pending' | 'closed' | undefined {
  const s = e?.booking_status;
  if (s === 'requested' || s === 'proposed') return 'pending';
  if (s === 'declined' || s === 'canceled') return 'closed';
  return undefined;
}

export const bookingCss = css`
  &[data-booking='pending'] { border-style: dashed !important; }
  &[data-booking='closed'] { opacity: 0.5; text-decoration: line-through; }
`;

/** 칸 안 제목 앞의 작은 «신청» 표시. 신청·제안일 때만 그린다. */
export function BookingTag({ e }: { e: WithBooking }) {
  const { t } = useTranslation('qcalendar');
  if (bookingAttr(e) !== 'pending') return null;
  return <Tag>{t('booking.chip', { defaultValue: '신청' })}</Tag>;
}

const Tag = styled.span`
  display:inline-block;margin-right:4px;padding:0 4px;border-radius:4px;
  font-size:0.625rem;font-weight:700;line-height:1.5;vertical-align:1px;
  background:#FEF3C7;color:#92400E;text-decoration:none;
`;
