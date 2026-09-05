// 게스트 링크 발급·회수 (운영 #259) — 고객 대화방 헤더에 붙는다.
//
// Irene: "카톡 채팅으로 일하는 고객이 하나도 불편하지 않게 우리 채팅에서 요청을 하게 할 방법."
//   그래서 이 버튼의 목표는 **멤버가 링크를 만들어 카톡으로 붙여넣는 데 3초**다.
//
// ★ 원문 토큰은 **발급 응답에만** 있다(서버는 해시만 저장). 이 화면이 놓치면 다시 만들어야 하므로
//   발급 직후 바로 보여주고 복사·공유를 그 자리에서 끝낸다.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';
// 타입·유효 판정은 guestLink.ts 단일 원천 (배너와 같은 술어를 써야 한다).
import { isLiveGuestLink, type GuestLink as Link } from './guestLink';


export default function GuestLinkButton({ businessId, conversationId, clientName, autoOpen, onClosed, endpoints, lead, title }: {
  businessId: number; conversationId: number; clientName: string;
  /** 프로젝트 헤더처럼 **다른 화면이 트리거를 그릴 때** 곧바로 열 때 (ProjectShareLinkButton). */
  autoOpen?: boolean;
  /** 모달이 닫힐 때 — 호출측이 자기 상태를 되돌린다. */
  onClosed?: () => void;
  /**
   * ★ 발급 주소만 갈아끼운다 — 모달·복사·공유·회수 UI 는 **한 벌**이어야 한다
   *   (docs/PROJECT_EXTERNAL_VIEW_DESIGN §9). 프로젝트 링크는 여기에 프로젝트 라우트를 준다.
   *   안 주면 종전대로 대화방 라우트 — 기존 호출부는 무변경으로 같은 동작이다.
   */
  endpoints?: { list: string; issue: string; revoke: (linkId: number) => string };
  /** 모달 안내 문구·제목 — 링크가 여는 것이 다르면 문구도 달라야 한다(문구가 거짓말이 되지 않게). */
  lead?: string;
  title?: string;
}) {
  const { t } = useTranslation('qtalk');
  const api = endpoints || {
    list: `/api/conversations/${businessId}/${conversationId}/guest-links`,
    issue: `/api/conversations/${businessId}/${conversationId}/guest-links`,
    revoke: (id: number) => `/api/conversations/${businessId}/${conversationId}/guest-links/${id}`,
  };
  const [open, setOpen] = useState(!!autoOpen);
  const [links, setLinks] = useState<Link[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);   // 방금 발급된 원문 URL
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // 문의 허용 — 기본 켬. 끄면 **읽기 전용 링크**다(설계 §5). 여태 화면에 없어서
  //   열람 전용 링크를 만들 방법이 아예 없었다(2026-09-05 Fable 지적 D1).
  const [canWrite, setCanWrite] = useState(true);
  // 서버가 거절한 이유를 화면이 말해야 한다. 여태 `if (!r.ok) return;` 이라 **눌러도 아무 일이
  //   안 일어났다** — 사용자에게는 "고장" 과 구별되지 않는다 (memory feedback_apifetch_no_throw_silent_save).
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch(api.list);
    if (!r.ok) return;
    const j = await r.json();
    if (j.success) setLinks((j.data || []).filter(isLiveGuestLink));
    // ★ deps 에 **주소**를 넣는다 — 어댑터로 주소가 갈리는데 deps 가 옛 키(businessId 등)면
    //   프로젝트 모달이 대화방 목록을 들고 있게 된다(memory feedback_guard_variable_needs_deps).
  }, [api.list]);

  useEffect(() => { if (open) { setFresh(null); setCopied(false); setErr(null); load(); } }, [open, load]);

  const issue = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await apiFetch(api.issue, {
        // 고객(client_id)은 보내지 않는다 — 서버가 **대화방에서** 읽는다.
        //   요청 body 의 client_id 를 서버가 믿으면 테넌트 우회 통로가 된다.
        //   보내는 것은 이 링크로 **문의까지 되게 할지**뿐이다.
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ can_write: canWrite }),
      });
      const j = await r.json().catch(() => ({} as { message?: string }));
      if (!r.ok) {
        const code = (j as { message?: string })?.message || '';
        setErr(
          code === 'guest_links_disabled' ? t('guestLink.errDisabled', { defaultValue: '게스트 링크 기능이 꺼져 있습니다. 관리자에게 문의해 주세요.' }) as string
          : code === 'not_customer_channel' ? t('guestLink.errNotCustomer', { defaultValue: '고객 대화방에서만 만들 수 있습니다.' }) as string
          : code === 'conversation_archived' ? t('guestLink.errArchived', { defaultValue: '보관된 대화방에는 만들 수 없습니다.' }) as string
          : code === 'project_closed' ? t('guestLink.errProjectClosed', { defaultValue: '완료된 프로젝트에는 만들 수 없습니다.' }) as string
          : t('guestLink.errGeneric', { defaultValue: '링크를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' }) as string,
        );
        return;
      }
      if (j.success && j.data?.url) { setFresh(j.data.url); await load(); }
    } finally { setBusy(false); }
  };

  const revoke = async (id: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch(api.revoke(id), { method: 'DELETE' });
      await load();
    } finally { setBusy(false); }
  };

  const copy = async () => {
    if (!fresh) return;
    try { await navigator.clipboard.writeText(fresh); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* noop */ }
  };

  // ★ 카톡 도달의 실질 — 폰에서 공유 시트를 열면 카톡이 목록에 뜬다.
  //   알림톡 연동(채널 개설·템플릿 심사·대행사 계약) 없이 v1 에서 되는 유일한 길이다.
  const share = async () => {
    if (!fresh) return;
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: clientName, url: fresh }); return; } catch { /* 사용자가 취소 */ }
    }
    copy();
  };

  return (
    <>
      {!autoOpen && <TriggerBtn type="button" onClick={() => setOpen(true)}
        data-testid="chat-guest-link-open"
        aria-label={t('guestLink.title', { defaultValue: '고객 링크' }) as string}
        title={t('guestLink.title', { defaultValue: '고객 링크' }) as string}>
        {/* 링크(사슬) 아이콘 — 헤더 아이콘들과 같은 16px/stroke 2 규격 */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </TriggerBtn>}
      {open && (
        <StandardModal open onClose={() => { setOpen(false); onClosed?.(); }} title={title || (t('guestLink.title', { defaultValue: '고객 링크' }) as string)} size="md">
          <Lead>{lead || (t('guestLink.lead', {
            defaultValue: '{{name}} 님이 로그인 없이 이 대화를 보고 답할 수 있는 링크입니다. 카톡·메일로 보내세요.',
            name: clientName,
          }) as string)}</Lead>

          {fresh ? (
            <FreshBox>
              <FreshLabel>{t('guestLink.freshLabel', { defaultValue: '링크가 만들어졌습니다 — 지금 복사해 주세요' })}</FreshLabel>
              <UrlRow>
                <UrlText readOnly value={fresh} onFocus={(e) => e.currentTarget.select()} />
              </UrlRow>
              <BtnRow>
                <ActionButton tone="primary" size="sm" onClick={share}>
                  {t('guestLink.share', { defaultValue: '보내기' })}
                </ActionButton>
                <ActionButton tone="secondary" size="sm" onClick={copy}>
                  {copied ? t('guestLink.copied', { defaultValue: '복사됨' }) : t('guestLink.copy', { defaultValue: '복사' })}
                </ActionButton>
              </BtnRow>
              {/* 원문은 다시 못 본다 — 서버가 해시만 갖는다. 그 사실을 숨기지 않는다. */}
              <Note>{t('guestLink.onceNote', { defaultValue: '이 주소는 지금만 보입니다. 나중에 다시 필요하면 새로 만들어 주세요 — 이전 링크도 계속 쓸 수 있습니다.' })}</Note>
            </FreshBox>
          ) : (
            <>
              {err && <ErrNote role="alert">{err}</ErrNote>}
              {/* 문의 허용 — 기본 켬. 끄면 읽기 전용 링크(설계 §5). 규칙을 설명하지 않고
                  **꺼졌을 때 무엇이 되는지**만 한 줄로 말한다. */}
              <WriteRow>
                <WriteLabel>
                  <input type="checkbox" checked={canWrite} data-testid="guest-link-canwrite"
                    onChange={(e) => setCanWrite(e.target.checked)} />
                  {t('guestLink.allowWrite', { defaultValue: '문의 보내기 허용' })}
                </WriteLabel>
                {!canWrite && <WriteNote>{t('guestLink.readOnlyNote', { defaultValue: '읽기 전용 링크 — 받는 사람은 보기만 합니다.' })}</WriteNote>}
              </WriteRow>
              <ActionButton tone="primary" size="md" onClick={issue} loading={busy}>
                {t('guestLink.issue', { defaultValue: '링크 만들기' })}
              </ActionButton>
            </>
          )}

          {links.length > 0 && (
            <ListBox>
              <ListTitle>{t('guestLink.active', { defaultValue: '살아 있는 링크' })}</ListTitle>
              {links.map((l) => (
                <Row key={l.id}>
                  <RowMain>
                    <Hint>…{l.token_hint}</Hint>
                    <Meta>
                      {l.last_used_at
                        ? t('guestLink.lastUsed', { defaultValue: '마지막 사용 {{d}}', d: String(l.last_used_at).slice(0, 10) })
                        : t('guestLink.neverUsed', { defaultValue: '아직 사용 안 함' })}
                      {l.message_count > 0 && ` · ${t('guestLink.msgs', { defaultValue: '{{n}}건 작성', n: l.message_count })}`}
                    </Meta>
                  </RowMain>
                  <RevokeBtn type="button" onClick={() => revoke(l.id)} disabled={busy}>
                    {t('guestLink.revoke', { defaultValue: '회수' })}
                  </RevokeBtn>
                </Row>
              ))}
              {links.some((l) => (l.contacts || []).some((c) => !c.revoked_at)) && (
                <>
                  <ListTitle>{t('guestLink.contacts', { defaultValue: '답글 알림을 신청한 사람' })}</ListTitle>
                  {links.flatMap((l) => (l.contacts || [])
                    .filter((c) => !c.revoked_at)
                    .map((c) => (
                      <Row key={`c${c.id}`}>
                        <RowMain>
                          <Hint>{c.name || '—'}</Hint>
                          <Meta>
                            {c.email || ''}
                            {' · '}
                            {c.verified_at
                              ? (c.unsubscribed_at
                                ? t('guestLink.contactOff', { defaultValue: '알림 꺼짐' })
                                : t('guestLink.contactOn', { defaultValue: '알림 켜짐' }))
                              : t('guestLink.contactPending', { defaultValue: '확인 안 됨' })}
                          </Meta>
                        </RowMain>
                        <RevokeBtn type="button" onClick={() => revoke(c.id)} disabled={busy}>
                          {t('guestLink.revoke', { defaultValue: '회수' })}
                        </RevokeBtn>
                      </Row>
                    )))}
                </>
              )}
            </ListBox>
          )}
        </StandardModal>
      )}
    </>
  );
}

// 아이콘 버튼 — 헤더에서 글자 폭을 먹지 않는다. 이름이 길면 제목이 밀려 헤더가 2줄이 됐다.
//   의미는 title/aria-label 로 전달한다(스크린리더·hover 둘 다).
const TriggerBtn = styled.button`
  width:36px;height:36px;flex-shrink:0;
  display:inline-flex;align-items:center;justify-content:center;
  border-radius:6px;border:1px solid #cbd5e1;background:#fff;
  color:#475569;cursor:pointer;
  &:hover{border-color:#0D9488;color:#0D9488;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
const WriteRow = styled.div`display:flex;flex-direction:column;gap:4px;margin-bottom:10px;`;
const WriteLabel = styled.label`
  display:inline-flex;align-items:center;gap:7px;cursor:pointer;
  font-size:0.8125rem;color:#334155;
  input{width:16px;aspect-ratio:1;accent-color:#14B8A6;cursor:pointer;}
`;
const WriteNote = styled.div`font-size:0.75rem;color:#94A3B8;padding-left:23px;`;
const Lead = styled.p`font-size:0.875rem;color:#475569;line-height:1.6;margin:0 0 16px;`;
const FreshBox = styled.div`border:1px solid #99F6E4;background:#F0FDFA;border-radius:8px;padding:14px;`;
const FreshLabel = styled.div`font-size:0.8125rem;font-weight:700;color:#0F766E;margin-bottom:8px;`;
const UrlRow = styled.div`display:flex;gap:6px;margin-bottom:10px;`;
const UrlText = styled.input`
  flex:1;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:0.8125rem;
  font-family:monospace;background:#fff;color:#0f172a;
`;
const BtnRow = styled.div`display:flex;gap:8px;`;
const Note = styled.div`font-size:0.75rem;color:#64748b;margin-top:10px;line-height:1.5;`;

// 서버가 거절한 이유. 조용히 삼키면 사용자에게는 "눌러도 아무 일이 없는 것" 이 된다.
const ErrNote = styled.div`
  margin-bottom: 10px;
  padding: 10px 12px;
  background: #FEF2F2;
  border: 1px solid #FECACA;
  border-radius: 8px;
  color: #991B1B;
  font-size: 0.8125rem;
  line-height: 1.5;
`;
const ListBox = styled.div`margin-top:18px;border-top:1px solid #e2e8f0;padding-top:14px;`;
const ListTitle = styled.div`font-size:0.75rem;font-weight:700;color:#64748b;margin-bottom:8px;`;
const Row = styled.div`display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9;&:last-child{border-bottom:none;}`;
const RowMain = styled.div`flex:1;min-width:0;`;
const Hint = styled.div`font-size:0.8125rem;font-family:monospace;color:#0f172a;`;
const Meta = styled.div`font-size:0.75rem;color:#94a3b8;margin-top:2px;`;
const RevokeBtn = styled.button`
  height:36px;padding:0 10px;border-radius:6px;border:1px solid #FECDD3;background:#fff;
  color:#F43F5E;font-size:0.75rem;font-weight:600;cursor:pointer;
  &:disabled{opacity:0.5;cursor:not-allowed;}
`;
