// 고객 창구 «안내» 탭 본문 = 워크스페이스 **공개 페이지 본문** — **한 벌**이다
//   (docs/CLIENT_ENTRY_DESIGN.md §4.2 · docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §3·§7 ①)
//
//   게스트 창구(`GuestWorkspacePage`) · 로그인 고객 홈(`ClientHomePage`) · 설정 «공개 페이지» 미리 보기가 같은 것을 쓴다.
//   두 화면이 같은 워크스페이스를 소개하는데 글·순서·버튼이 다르면 고객은 다른 회사로 읽는다.
//   데이터 모양은 서버 `services/workspacePage.js publicView` 한 함수다 — 가린 항목은 **응답에 없다**(여기서 가리지 않는다).
//   부모의 탭 본문(GuestTabPane)에 **직계 자식으로** 얹히도록 조각(fragment)을 돌려준다.
//   비어 있는 구역은 통째로 없다(빈 «서비스» 제목만 남지 않는다 — 설계 §7).
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { Empty } from './guestShell';
import type { EntryInfo } from './GuestWorkspacePage';
import { useRef, useState } from 'react';
import InquiryForm from './InquiryForm';
import { formatWorkHours } from '../../utils/workHoursText';

type Props = {
  entry: EntryInfo | null;
  bookingOn: boolean;
  onAsk: () => void;
  onBook: () => void;
  /** 서비스 카드의 [이 서비스 문의] — 없으면 onAsk 로 간다 */
  onAskService?: (serviceId: string, name: string) => void;
  /** 소개가 없을 때 대신 보일 말 — 로그인 고객 홈은 «아직 소개가 없어요» 대신 여기서 할 수 있는 것을 말한다 */
  emptyText?: string;
  /** 미리 보기 — 버튼을 눌러도 아무 데도 가지 않는다(설정 화면) */
  preview?: boolean;
  /** 문의 폼 POST 주소 — 있으면(그리고 워크스페이스가 폼을 켰으면) 본문 맨 아래에 «문의 남기기» 폼(설계 §7 ①).
   *  없으면(로그인 고객 홈) 폼 없이 종전처럼 [문의하기] = 채팅. */
  inquiryUrl?: string | null;
  /** 폼 문구의 회사 이름 */
  workspaceName?: string;
  /** 공개 주소(/w/) — 머리에 이미 [문의하기][상담 예약] 이 있어 본문 첫 줄 버튼을 감춘다 */
  hideActions?: boolean;
  /** 공개 주소 데스크탑 — 본문 | 오른쪽에 따라오는 문의 카드(설계 §7 ①). 1024 이하는 한 칸(폼은 맨 아래) */
  splitForm?: boolean;
};

type Svc = { id: string; name: string; summary: string | null; price_text: string | null; image_url: string | null };
/** 옛 응답(서비스 = 문자열)도 그린다 — 배포 순간 열린 창이 깨지지 않게. */
const servicesOf = (e: EntryInfo | null): Svc[] => (e?.services || []).map((s: unknown, i) => (
  typeof s === 'string'
    ? { id: `s${i}`, name: s, summary: null, price_text: null, image_url: null }
    : (s as Svc)
)).filter((s) => s && s.name);

export default function EntryInfoView({ entry, bookingOn, onAsk, onBook, onAskService, emptyText, preview, inquiryUrl, workspaceName, hideActions, splitForm }: Props) {
  // 폼이 있으면 [문의하기]·[이 서비스 문의] 는 폼으로 내려간다(서비스를 미리 골라서) — 인증 없이 바로 남기는 문
  const formOn = !!entry?.form?.enabled && (!!inquiryUrl || !!preview);
  const formRef = useRef<HTMLDivElement>(null);
  const [presetSvc, setPresetSvc] = useState<string | null>(null);
  const { t } = useTranslation('guest');
  const services = servicesOf(entry);
  const c = entry?.contact;
  const hours = entry?.work_hours ? formatWorkHours(entry.work_hours, t) : null;
  const extras = entry?.extras || [];
  const infoRows: { key: string; label: string; node: React.ReactNode }[] = [];
  if (c?.website) infoRows.push({ key: 'website', label: t('entry.website', { defaultValue: '홈페이지' }),
    // 외부 주소는 새 탭 + noreferrer·nofollow — 우리 화면 주소가 제3자에게 가지 않게, 사용자 글 링크로 평판을 주지 않게.
    node: <a href={c.website} target="_blank" rel="noopener noreferrer nofollow ugc">{c.website.replace(/^https?:\/\//, '')}</a> });
  if (c?.phone) infoRows.push({ key: 'phone', label: t('entry.phone', { defaultValue: '전화' }), node: <a href={`tel:${c.phone}`}>{c.phone}</a> });
  if (c?.email) infoRows.push({ key: 'email', label: t('entry.email', { defaultValue: '이메일' }), node: <a href={`mailto:${c.email}`}>{c.email}</a> });
  if (hours) infoRows.push({ key: 'work_hours', label: t('entry.workHours', { defaultValue: '근무시간' }), node: <span>{hours}</span> });
  if (c?.address) infoRows.push({ key: 'address', label: t('entry.address', { defaultValue: '주소' }), node: <span>{c.address}</span> });
  if (entry?.representative) infoRows.push({ key: 'representative', label: t('entry.representative', { defaultValue: '대표자' }), node: <span>{entry.representative}</span> });
  if (entry?.biz_type) infoRows.push({ key: 'biz_type', label: t('entry.bizType', { defaultValue: '업태·종목' }), node: <span>{entry.biz_type}</span> });
  extras.forEach((x, i) => infoRows.push({
    key: `extra-${i}`, label: x.label,
    node: x.href
      ? <a href={x.href} target="_blank" rel="noopener noreferrer nofollow ugc">{x.value}</a>
      : <span>{x.value}</span>,
  }));

  const ask = (s?: Svc) => {
    if (preview) return;
    if (formOn) {
      if (s) setPresetSvc(s.id);
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (s && onAskService) onAskService(s.id, s.name); else onAsk();
  };

  const form = formOn ? (
    <InquiryForm ref={formRef} submitUrl={preview ? null : (inquiryUrl || null)} preview={preview}
      workspaceName={workspaceName || ''}
      services={services.map((x) => ({ id: x.id, name: x.name }))}
      askPhone={!!entry?.form?.ask_phone} askCompany={!!entry?.form?.ask_company}
      presetServiceId={presetSvc} />
  ) : null;

  const body = (
    <>
      {!hideActions && <BtnRow>
        <AskBtn type="button" data-testid="entry-go-chat" onClick={() => ask()} disabled={preview}>
          {t('entry.goChat', { defaultValue: '문의하기' })}
        </AskBtn>
        {bookingOn && (
          <AskGhost type="button" data-testid="entry-go-book" onClick={preview ? undefined : onBook} disabled={preview}>
            {t('entry.goBook', { defaultValue: '상담 예약' })}
          </AskGhost>
        )}
      </BtnRow>}

      {entry?.intro ? (
        <Section data-testid="entry-sec-intro">
          <Label>{t('entry.intro', { defaultValue: '소개' })}</Label>
          <Para>{entry.intro}</Para>
        </Section>
      ) : (services.length === 0 && infoRows.length === 0) ? (
        <Empty>{emptyText || t('entry.noIntro', { defaultValue: '아직 소개가 등록되지 않았어요.' })}</Empty>
      ) : null}

      {services.length > 0 && (
        <Section data-testid="entry-sec-services">
          <Label>{t('entry.services', { defaultValue: '서비스' })}</Label>
          <Cards>
            {services.map((s) => (
              <SvcCard key={s.id} data-testid={`entry-service-card-${s.id}`}>
                {s.image_url && <SvcImg src={`${s.image_url}?w=640`} alt="" loading="lazy" />}
                <SvcBody>
                  <SvcName>{s.name}</SvcName>
                  {s.summary && <SvcSummary>{s.summary}</SvcSummary>}
                  {s.price_text && <SvcPrice>{s.price_text}</SvcPrice>}
                  <SvcAsk type="button" onClick={() => ask(s)} disabled={preview} data-testid={`entry-service-ask-${s.id}`}>
                    {t('entry.askService', { defaultValue: '이 서비스 문의' })}
                  </SvcAsk>
                </SvcBody>
              </SvcCard>
            ))}
          </Cards>
        </Section>
      )}

      {infoRows.length > 0 && (
        <Section data-testid="entry-sec-info">
          <Label>{t('entry.companyInfo', { defaultValue: '회사 정보' })}</Label>
          {infoRows.map((r) => (
            <CRow key={r.key} data-testid={`entry-info-${r.key}`}><CKey>{r.label}</CKey><CVal>{r.node}</CVal></CRow>
          ))}
        </Section>
      )}
      {!splitForm && form}
    </>
  );
  if (splitForm && form) {
    return (
      <Split>
        <SplitMain>{body}</SplitMain>
        <SplitSide>{form}</SplitSide>
      </Split>
    );
  }
  return body;
}

// 공개 주소 데스크탑 — 본문 | 오른쪽 문의 카드(스크롤해도 따라온다). 1024 이하 한 칸.
const Split = styled.div`
  display:grid;grid-template-columns:minmax(0, 1fr) minmax(300px, 360px);gap:24px;align-items:start;
  @media (max-width:1024px){ grid-template-columns:minmax(0, 1fr); }
`;
const SplitMain = styled.div`display:flex;flex-direction:column;gap:18px;min-width:0;`;
const SplitSide = styled.div`position:sticky;top:16px;min-width:0;@media (max-width:1024px){ position:static; }`;
const Para = styled.p`margin:0;font-size:0.8125rem;color:#475569;line-height:1.6;white-space:pre-wrap;`;
const Section = styled.div`display:flex;flex-direction:column;gap:8px;`;
export const Label = styled.div`font-size:0.6875rem;font-weight:600;color:#94a3b8;letter-spacing:-0.1px;`;
// 서비스 카드 — 폰 한 줄 하나 · 넓으면 2~3열(고정 폭 없이 minmax).
const Cards = styled.div`
  display:grid;gap:10px;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));
  /* 카드는 제 높이 — 사진 없는 카드가 옆 사진 카드 높이로 늘어나 빈 칸이 크게 생기지 않게 */
  align-items:start;
`;
const SvcCard = styled.div`
  display:flex;flex-direction:column;min-width:0;background:#fff;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;
`;
const SvcImg = styled.img`display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#F1F5F9;`;
const SvcBody = styled.div`display:flex;flex-direction:column;gap:4px;padding:12px 14px 14px;flex:1;& > button{margin-top:auto;}`;
const SvcName = styled.div`font-size:0.875rem;font-weight:700;color:#0F172A;word-break:keep-all;overflow-wrap:anywhere;`;
const SvcSummary = styled.div`font-size:0.75rem;color:#475569;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;`;
const SvcPrice = styled.div`font-size:0.75rem;font-weight:700;color:#0D9488;`;
const SvcAsk = styled.button`
  align-self:flex-start;margin-top:auto;min-height:32px;padding:0 12px;border-radius:8px;cursor:pointer;
  border:1px solid #CBD5E1;background:#fff;color:#334155;font-size:0.75rem;font-weight:700;
  &:hover:not(:disabled){border-color:#14B8A6;color:#0D9488;}
  &:disabled{cursor:default;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
const CRow = styled.div`
  display:flex;align-items:baseline;gap:8px;font-size:0.8125rem;color:#334155;min-width:0;
  a{color:#0D9488;text-decoration:none;&:hover{text-decoration:underline;}}
`;
const CKey = styled.span`flex-shrink:0;min-width:4.5rem;max-width:40%;font-size:0.75rem;color:#94A3B8;overflow-wrap:anywhere;`;
const CVal = styled.span`min-width:0;overflow-wrap:anywhere;white-space:pre-wrap;`;
// 주요 행동 — 3톤 규칙의 Primary. 프로젝트 화면 AskBtn 과 같은 값이다.
export const AskBtn = styled.button`
  align-self:flex-start;min-height:40px;padding:0 16px;border-radius:10px;cursor:pointer;
  border:none;background:#14B8A6;color:#fff;font-size:0.875rem;font-weight:700;
  &:hover:not(:disabled){background:#0D9488;}
  &:disabled{cursor:default;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
const BtnRow = styled.div`display:flex;flex-wrap:wrap;gap:8px;`;
// 보조 행동 — 3톤 규칙의 Secondary. 높이·모서리는 AskBtn 과 같다.
const AskGhost = styled.button`
  min-height:40px;padding:0 16px;border-radius:10px;cursor:pointer;
  border:1px solid #CBD5E1;background:#fff;color:#334155;font-size:0.875rem;font-weight:700;
  &:hover:not(:disabled){border-color:#14B8A6;}
  &:disabled{cursor:default;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
