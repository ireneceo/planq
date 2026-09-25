// 고객 창구 «안내» 탭 본문 — **한 벌**이다 (docs/CLIENT_ENTRY_DESIGN.md §4.2 · §4.7)
//
//   게스트 창구(`GuestWorkspacePage`)와 로그인 고객 홈(`ClientHomePage`)이 같은 것을 쓴다.
//   두 화면이 같은 워크스페이스를 소개하는데 글·순서·버튼이 다르면 고객은 다른 회사로 읽는다.
//   부모의 탭 본문(GuestTabPane)에 **직계 자식으로** 얹히도록 조각(fragment)을 돌려준다.
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { Empty } from './guestShell';
import type { EntryInfo } from './GuestWorkspacePage';

type Props = {
  entry: EntryInfo | null;
  bookingOn: boolean;
  onAsk: () => void;
  onBook: () => void;
};

export default function EntryInfoView({ entry, bookingOn, onAsk, onBook }: Props) {
  const { t } = useTranslation('guest');
  return (
    <>
      {entry?.intro ? <Para>{entry.intro}</Para> : (
        <Empty>{t('entry.noIntro', { defaultValue: '아직 소개가 등록되지 않았어요.' })}</Empty>
      )}
      {entry?.services && entry.services.length > 0 && (
        <Section>
          <Label>{t('entry.services', { defaultValue: '제공 서비스' })}</Label>
          <Chips>{entry.services.map((s, i) => <Chip key={i}>{s}</Chip>)}</Chips>
        </Section>
      )}
      {entry?.contact && (entry.contact.phone || entry.contact.email
        || entry.contact.website || entry.contact.address) && (
        <Section>
          <Label>{t('entry.contact', { defaultValue: '연락처' })}</Label>
          {entry.contact.phone && (
            <CRow><CKey>{t('entry.phone', { defaultValue: '전화' })}</CKey>
              <a href={`tel:${entry.contact.phone}`}>{entry.contact.phone}</a></CRow>
          )}
          {entry.contact.email && (
            <CRow><CKey>{t('entry.email', { defaultValue: '이메일' })}</CKey>
              <a href={`mailto:${entry.contact.email}`}>{entry.contact.email}</a></CRow>
          )}
          {entry.contact.website && (
            <CRow><CKey>{t('entry.website', { defaultValue: '홈페이지' })}</CKey>
              {/* 외부 주소는 새 탭 + noreferrer — 우리 화면 주소가 제3자에게 가지 않게. */}
              <a href={entry.contact.website} target="_blank" rel="noopener noreferrer">{entry.contact.website}</a></CRow>
          )}
          {entry.contact.address && (
            <CRow><CKey>{t('entry.address', { defaultValue: '주소' })}</CKey>
              <span>{entry.contact.address}</span></CRow>
          )}
        </Section>
      )}
      <BtnRow>
        <AskBtn type="button" data-testid="entry-go-chat" onClick={onAsk}>
          {t('entry.goChat', { defaultValue: '문의하기' })}
        </AskBtn>
        {bookingOn && (
          <AskGhost type="button" data-testid="entry-go-book" onClick={onBook}>
            {t('entry.goBook', { defaultValue: '상담 예약' })}
          </AskGhost>
        )}
      </BtnRow>
    </>
  );
}

const Para = styled.p`margin:0;font-size:0.8125rem;color:#475569;line-height:1.6;white-space:pre-wrap;`;
const Section = styled.div`display:flex;flex-direction:column;gap:6px;`;
export const Label = styled.div`font-size:0.6875rem;font-weight:600;color:#94a3b8;letter-spacing:-0.1px;`;
const Chips = styled.div`display:flex;flex-wrap:wrap;gap:6px;`;
const Chip = styled.span`
  display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;
  background:#F1F5F9;color:#475569;font-size:0.6875rem;font-weight:600;
`;
const CRow = styled.div`
  display:flex;align-items:baseline;gap:8px;font-size:0.8125rem;color:#334155;
  a{color:#0D9488;text-decoration:none;&:hover{text-decoration:underline;}}
`;
const CKey = styled.span`flex-shrink:0;min-width:3.5rem;font-size:0.75rem;color:#94A3B8;`;
// 주요 행동 — 3톤 규칙의 Primary. 프로젝트 화면 AskBtn 과 같은 값이다.
export const AskBtn = styled.button`
  align-self:flex-start;min-height:40px;padding:0 16px;border-radius:10px;cursor:pointer;
  border:none;background:#14B8A6;color:#fff;font-size:0.875rem;font-weight:700;
  &:hover{background:#0D9488;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
const BtnRow = styled.div`display:flex;flex-wrap:wrap;gap:8px;`;
// 보조 행동 — 3톤 규칙의 Secondary. 높이·모서리는 AskBtn 과 같다.
const AskGhost = styled.button`
  min-height:40px;padding:0 16px;border-radius:10px;cursor:pointer;
  border:1px solid #CBD5E1;background:#fff;color:#334155;font-size:0.875rem;font-weight:700;
  &:hover{border-color:#14B8A6;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
