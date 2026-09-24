// 게스트 링크 발급·회수 (운영 #259) — 고객 대화방 헤더에 붙는다.
//
// Irene: "카톡 채팅으로 일하는 고객이 하나도 불편하지 않게 우리 채팅에서 요청을 하게 할 방법."
//   그래서 이 버튼의 목표는 **멤버가 링크를 만들어 카톡으로 붙여넣는 데 3초**다.
//
// ★ 2026-09-24 — 주소를 **다시 볼 수 있다**(docs/GUEST_PROJECT_VIEW_DECISIONS.md §B). 토큰이 파생값이라
//   목록이 살아 있는 링크의 `url` 을 싣는다. 옛 화면은 "지금만 보입니다 — 나중엔 새로 만드세요" 라고
//   말했고, 그래서 사람들이 링크를 계속 새로 만들었다(운영 실측: 한 프로젝트에 셋).
//   → 링크가 있으면 [링크 만들기] 를 **숨기고** [새 링크로 교체] 만 둔다(옛것을 닫고 만든다, 확인 받음).
//   → 옛 난수 링크는 서버도 원문을 모른다(`url: null`) — 그 사실과 교체 문을 보인다.
import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from '../Common/ConfirmDialog';
import { formatPublicDate } from '../../utils/dateFormat';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';
// 타입·유효 판정은 guestLink.ts 단일 원천 (배너와 같은 술어를 써야 한다).
import { isLiveGuestLink, type GuestLink as Link } from './guestLink';


export default function GuestLinkButton({ businessId, conversationId, clientName, autoOpen, onClosed, endpoints, lead, title, scope = 'conversation' }: {
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
  /** 이 모달이 **만드는** 링크의 종류. 발급이 이 종류로 멱등이다 — 다른 종류 링크는 목록에만 보인다. */
  scope?: 'conversation' | 'project';
}) {
  const { t } = useTranslation('qtalk');
  const api = endpoints || {
    list: `/api/conversations/${businessId}/${conversationId}/guest-links`,
    issue: `/api/conversations/${businessId}/${conversationId}/guest-links`,
    revoke: (id: number) => `/api/conversations/${businessId}/${conversationId}/guest-links/${id}`,
  };
  const [open, setOpen] = useState(!!autoOpen);
  const [links, setLinks] = useState<Link[]>([]);
  const [justIssued, setJustIssued] = useState(false);   // 방금 만들었다 — 안내 한 줄만 바뀐다
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

  useEffect(() => { if (open) { setJustIssued(false); setCopied(false); setErr(null); load(); } }, [open, load]);

  // 이 모달이 책임지는 링크 — 같은 종류로 **하나**다(서버 발급이 멱등). 없으면 만드는 문, 있으면 교체하는 문.
  const own = links.find((l) => (l.scope || 'conversation') === scope) || null;
  const others = links.filter((l) => l !== own);
  // 교체할 때의 «문의 허용» — 기존 링크 값에서 시작한다(재사용은 기존 값을 바꾸지 않는다, §B-5).
  useEffect(() => { if (own) setCanWrite(!!own.can_write); }, [own?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const issue = async (replace: boolean) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch(api.issue, {
        // 고객(client_id)은 보내지 않는다 — 서버가 **대화방에서** 읽는다.
        //   요청 body 의 client_id 를 서버가 믿으면 테넌트 우회 통로가 된다.
        //   보내는 것은 이 링크로 **문의까지 되게 할지**와, 기존 링크를 **교체**할지뿐이다.
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ can_write: canWrite, ...(replace ? { replace: true } : {}) }),
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
      // 200 reused(다른 멤버가 방금 만든 것) · 201 issued 둘 다 목록을 다시 읽으면 주소가 보인다.
      if (j.success) { setJustIssued(r.status === 201); setConfirmReplace(false); await load(); }
    } finally { setBusy(false); }
  };
  // 교체는 **밖으로 영향이 가는** 행동이다 — 옛 주소로 들어오던 사람과 알림 신청자가 끊긴다. 확인을 받는다.
  const [confirmReplace, setConfirmReplace] = useState(false);

  // 닫기 전에 **무슨 일이 일어나는지** 먼저 말한다.
  //   Irene 2026-09-10: "회수 누르면 뭐가 어떻게 되지? 링크 삭제야?"
  //   실제 동작은 삭제가 아니라 revoked_at 마킹이고, 그 즉시 그 주소로 들어오던 사람이 막힌다.
  //   되살리는 경로가 없으므로 되돌릴 수 없는 행동이다 — 확인 없이 한 번에 실행하면 안 된다.
  const [confirmId, setConfirmId] = useState<{ id: number; kind: 'link' | 'person' } | null>(null);
  const revoke = async (id: number) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch(api.revoke(id), { method: 'DELETE' });
      const j = await r.json().catch(() => ({ success: r.ok }));
      // ★ 여태 응답을 **아예 안 봤다.** 403/404 여도 조용히 목록만 다시 불러서,
      //   실패했는데 사용자는 아무 일도 안 일어난 것으로만 보였다.
      if (!j.success) { setErr(t('guestLink.revokeFailed', { defaultValue: '닫지 못했습니다. 잠시 후 다시 시도해 주세요.' }) as string); return; }
      setConfirmId(null);
      await load();
    } finally { setBusy(false); }
  };

  const url = own?.url || null;
  const copy = async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* noop */ }
  };

  // ★ 카톡 도달의 실질 — 폰에서 공유 시트를 열면 카톡이 목록에 뜬다.
  //   알림톡 연동(채널 개설·템플릿 심사·대행사 계약) 없이 v1 에서 되는 유일한 길이다.
  const share = async () => {
    if (!url) return;
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: clientName, url }); return; } catch { /* 사용자가 취소 */ }
    }
    copy();
  };
  const scopeChip = (l: Link) => ((l.scope || 'conversation') === 'project'
    ? t('guestLink.scopeProject', { defaultValue: '프로젝트 열람' })
    : t('guestLink.scopeConversation', { defaultValue: '대화만' }));
  const linkMeta = (l: Link) => (
    <>
      {/* "살아 있다" 가 무슨 뜻인지 **날짜로** 말한다. 만료는 열 때마다 뒤로 밀린다. */}
      {l.expires_at && t('guestLink.until', { defaultValue: '{{d}}까지 열림', d: formatPublicDate(l.expires_at) })}
      {l.expires_at && ' · '}
      {l.last_used_at
        ? t('guestLink.lastUsed', { defaultValue: '마지막 열람 {{d}}', d: formatPublicDate(l.last_used_at) })
        : t('guestLink.neverUsed', { defaultValue: '아직 아무도 열지 않음' })}
      {!l.can_write && ` · ${t('guestLink.readOnly', { defaultValue: '읽기 전용' })}`}
      {l.message_count > 0 && ` · ${t('guestLink.msgs', { defaultValue: '{{n}}건 작성', n: l.message_count })}`}
    </>
  );
  const writeRow = (
    // 문의 허용 — 기본 켬. 끄면 읽기 전용 링크(설계 §5). 규칙을 설명하지 않고
    //   **꺼졌을 때 무엇이 되는지**만 한 줄로 말한다. 링크가 있으면 «교체할 새 링크» 의 값이다.
    <WriteRow>
      <WriteLabel>
        <input type="checkbox" checked={canWrite} data-testid="guest-link-canwrite"
          onChange={(e) => setCanWrite(e.target.checked)} />
        {t('guestLink.allowWrite', { defaultValue: '문의 보내기 허용' })}
      </WriteLabel>
      {!canWrite && <WriteNote>{t('guestLink.readOnlyNote', { defaultValue: '읽기 전용 링크 — 받는 사람은 보기만 합니다.' })}</WriteNote>}
    </WriteRow>
  );

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

          {err && <ErrNote role="alert">{err}</ErrNote>}
          {own ? (
            <FreshBox data-testid="guest-link-own">
              <FreshLabel>
                {justIssued
                  ? t('guestLink.freshLabel2', { defaultValue: '링크가 만들어졌습니다' })
                  : t('guestLink.ownLabel', { defaultValue: '지금 쓰는 링크' })}
                <ScopeChip>{scopeChip(own)}</ScopeChip>
              </FreshLabel>
              {url ? (
                <>
                  <UrlRow>
                    <UrlText readOnly value={url} data-testid="guest-link-url" onFocus={(e) => e.currentTarget.select()} />
                  </UrlRow>
                  <BtnRow>
                    <ActionButton tone="primary" size="sm" onClick={share}>
                      {t('guestLink.share', { defaultValue: '보내기' })}
                    </ActionButton>
                    <ActionButton tone="secondary" size="sm" onClick={copy}>
                      {copied ? t('guestLink.copied', { defaultValue: '복사됨' }) : t('guestLink.copy', { defaultValue: '복사' })}
                    </ActionButton>
                  </BtnRow>
                  <Note>{t('guestLink.reusableNote', { defaultValue: '이 주소는 언제든 여기서 다시 볼 수 있어요. 같은 링크를 계속 보내면 됩니다.' })}</Note>
                </>
              ) : (
                // 옛 방식(난수) 링크 — 서버도 원문을 모른다. 숨기지 않고 말하고, 교체 문을 준다.
                <Note data-testid="guest-link-legacy">
                  <Hint>/g/{own.token_hint}…</Hint>
                  {t('guestLink.legacyNote', { defaultValue: '이전 방식 링크라 주소를 다시 볼 수 없어요. 주소가 필요하면 새 링크로 교체하세요.' })}
                </Note>
              )}
              <Meta>{linkMeta(own)}</Meta>
              <ReplaceBox>
                {writeRow}
                <ReplaceRow>
                  <ActionButton tone="secondary" size="sm" onClick={() => setConfirmReplace(true)} disabled={busy}
                    data-testid="guest-link-replace">
                    {t('guestLink.replace', { defaultValue: '새 링크로 교체' })}
                  </ActionButton>
                  <RevokeBtn type="button" onClick={() => setConfirmId({ id: own.id, kind: 'link' })} disabled={busy}>
                    {t('guestLink.close', { defaultValue: '링크 닫기' })}
                  </RevokeBtn>
                </ReplaceRow>
              </ReplaceBox>
            </FreshBox>
          ) : (
            <>
              {writeRow}
              <ActionButton tone="primary" size="md" onClick={() => issue(false)} loading={busy} data-testid="guest-link-issue">
                {t('guestLink.issue', { defaultValue: '링크 만들기' })}
              </ActionButton>
            </>
          )}

          {(others.length > 0 || links.some((l) => (l.contacts || []).some((c) => !c.revoked_at))) && (
            <ListBox>
              {others.length > 0 && <ListTitle>{t('guestLink.active', { defaultValue: '지금 열려 있는 링크' })}</ListTitle>}
              {others.map((l) => (
                <Row key={l.id}>
                  <RowMain>
                    {/* 토큰 **앞** 6자다. 여태 `…Fq-386` 으로 그려 접미사처럼 보였고,
                        그래서 보낸 주소(planq.kr/g/Fq-386…)와 눈으로 대조할 수 없었다. */}
                    <Hint>/g/{l.token_hint}… <ScopeChip>{scopeChip(l)}</ScopeChip></Hint>
                    <Meta>{linkMeta(l)}</Meta>
                  </RowMain>
                  <RevokeBtn type="button" onClick={() => setConfirmId({ id: l.id, kind: 'link' })} disabled={busy}>
                    {t('guestLink.close', { defaultValue: '링크 닫기' })}
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
                        {/* 같은 라벨을 쓰면 안 된다 — 이건 링크가 아니라 **이 사람**의 접근을 끊는다. */}
                        <RevokeBtn type="button" onClick={() => setConfirmId({ id: c.id, kind: 'person' })} disabled={busy}>
                          {t('guestLink.cutPerson', { defaultValue: '접근 끊기' })}
                        </RevokeBtn>
                      </Row>
                    )))}
                </>
              )}
            </ListBox>
          )}
        </StandardModal>
      )}
      {/* 되돌릴 수 없는 행동이라 **누르기 전에** 무슨 일이 일어나는지 말한다.
          Irene 2026-09-10: "회수 누르면 뭐가 어떻게 되지? 링크 삭제야?" — 삭제가 아니다. */}
      <ConfirmDialog
        isOpen={!!confirmId}
        variant="danger"
        onClose={() => setConfirmId(null)}
        onConfirm={() => { if (confirmId) void revoke(confirmId.id); }}
        title={confirmId?.kind === 'person'
          ? (t('guestLink.cutPersonTitle', { defaultValue: '이 사람의 접근을 끊을까요?' }) as string)
          : (t('guestLink.closeTitle', { defaultValue: '이 링크를 닫을까요?' }) as string)}
        message={confirmId?.kind === 'person'
          ? (t('guestLink.cutPersonBody', { defaultValue: '이 사람은 지금 바로 들어올 수 없게 되고 알림도 멈춥니다. 다시 열 수 없어 새로 초대해야 합니다. 주고받은 내용은 그대로 남습니다.' }) as string)
          : (t('guestLink.closeBody', { defaultValue: '이 주소로 들어오던 사람이 지금 바로 못 들어옵니다. 다시 열 수 없고 새 링크를 만들어야 합니다. 주고받은 대화와 파일은 그대로 남습니다.' }) as string)}
        confirmText={confirmId?.kind === 'person'
          ? (t('guestLink.cutPerson', { defaultValue: '접근 끊기' }) as string)
          : (t('guestLink.close', { defaultValue: '링크 닫기' }) as string)}
        cancelText={t('common:cancel', { defaultValue: '취소' }) as string}
      />
      <ConfirmDialog
        isOpen={confirmReplace}
        variant="danger"
        onClose={() => setConfirmReplace(false)}
        onConfirm={() => { void issue(true); }}
        title={t('guestLink.replaceTitle', { defaultValue: '새 링크로 교체할까요?' }) as string}
        message={t('guestLink.replaceBody', { defaultValue: '지금 링크는 닫히고 새 주소가 만들어집니다. 이전 주소로 들어오던 사람·답글 알림 신청자가 끊깁니다. 주고받은 대화와 파일은 그대로 남습니다.' }) as string}
        confirmText={t('guestLink.replace', { defaultValue: '새 링크로 교체' }) as string}
        cancelText={t('common:cancel', { defaultValue: '취소' }) as string}
      />
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
const ScopeChip = styled.span`
  display:inline-flex;align-items:center;padding:1px 6px;margin-left:6px;border-radius:4px;line-height:16px;
  background:#F1F5F9;color:#475569;font-size:0.6875rem;font-weight:600;font-family:inherit;vertical-align:middle;
`;
const ReplaceBox = styled.div`margin-top:12px;padding-top:12px;border-top:1px solid #CCFBF1;`;
const ReplaceRow = styled.div`display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;`;
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
