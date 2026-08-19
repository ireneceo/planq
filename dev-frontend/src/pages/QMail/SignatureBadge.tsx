// #262 — "이 메일에 붙는 서명" 표시. Irene: "서명이 팀서명과 개인서명 뭐가 붙는지도 모르고 알 수도 없어."
//
// 서명은 발송 시점에 서버가 별칭 > 계정 > 워크스페이스 순으로 고른다. 화면엔 그 결과가 전혀 없었다.
// 여기서 서버의 **같은 함수**가 계산한 결과(GET mail-outgoing-identity)를 그대로 보여준다 —
// 프론트가 우선순위를 재구현하면 실발송과 어긋나므로 절대 계산하지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import { sanitizeMailHtml } from '../../utils/sanitizeHtml';

export type SignatureSource = 'alias' | 'account' | 'workspace' | 'none' | 'disabled';

interface Identity {
  from_name: string | null;
  from_email: string;
  signature_source: SignatureSource;
  signature_html: string | null;
}

interface Props {
  businessId: number | null;
  /** 답장이면 스레드 id — 서버가 '받은 주소' 로 별칭을 자동 결정하는 분기를 그대로 태운다 */
  threadId?: number | null;
  accountId?: number | null;
  /** 사용자가 고른 별칭 (0 = 계정 주소 명시 선택) */
  fromAliasId?: number | null;
  /** 이 발송에만 서명을 붙일지 */
  enabled: boolean;
  onToggle: (next: boolean) => void;
  /** 계산된 발신 정체성을 상위로 — 발신 주소 표시를 실발송과 같은 값으로 맞추기 위해.
   *  여기서 이미 한 번 조회하므로 상위가 따로 부르지 않게 한다(중복 호출 금지). */
  onIdentity?: (ident: Identity | null) => void;
}

export default function SignatureBadge({ businessId, threadId, accountId, fromAliasId, enabled, onToggle, onIdentity }: Props) {
  const { t } = useTranslation('qmail');
  const [ident, setIdent] = useState<Identity | null>(null);
  // 콜백을 deps 에 넣으면 상위 렌더마다 재조회된다 — ref 로 최신 값만 참조한다.
  const onIdentityRef = useRef(onIdentity);
  onIdentityRef.current = onIdentity;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!businessId) { setIdent(null); onIdentityRef.current?.(null); return; }
    let alive = true;
    const qs = new URLSearchParams();
    if (threadId) qs.set('thread_id', String(threadId));
    if (accountId) qs.set('account_id', String(accountId));
    if (fromAliasId !== null && fromAliasId !== undefined) qs.set('from_alias_id', String(fromAliasId));
    (async () => {
      try {
        const r = await apiFetch(`/api/businesses/${businessId}/mail-outgoing-identity?${qs.toString()}`);
        if (!r.ok) { if (alive) { setIdent(null); onIdentityRef.current?.(null); } return; }
        const j = await r.json();
        if (alive) { const v = j.success ? j.data : null; setIdent(v); onIdentityRef.current?.(v); }
      } catch { if (alive) { setIdent(null); onIdentityRef.current?.(null); } }
    })();
    return () => { alive = false; };
  }, [businessId, threadId, accountId, fromAliasId]);

  const toggle = useCallback(() => onToggle(!enabled), [enabled, onToggle]);

  if (!ident) return null;

  // 폴백 문구는 t() 안에 직접 둔다 — 객체 리터럴로 빼면 i18n 가드가 하드코딩으로 읽는다.
  const srcLabel = ({
    alias: () => t('signature.source.alias', { defaultValue: '별칭 서명' }),
    account: () => t('signature.source.account', { defaultValue: '개인 서명' }),
    workspace: () => t('signature.source.workspace', { defaultValue: '팀 공통 서명' }),
    none: () => t('signature.source.none', { defaultValue: '서명 없음' }),
    disabled: () => t('signature.source.disabled', { defaultValue: '서명 꺼짐' }),
  })[ident.signature_source]() as string;
  const hasSig = ident.signature_source === 'alias' || ident.signature_source === 'account' || ident.signature_source === 'workspace';

  return (
    <Wrap data-testid="mail-signature-badge">
      <Row>
        <Label>{t('signature.label', { defaultValue: '서명' }) as string}</Label>
        <Src $muted={!hasSig}>{srcLabel}</Src>
        {hasSig && (
          <>
            <LinkBtn type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}>
              {open
                ? t('signature.hide', { defaultValue: '접기' }) as string
                : t('signature.preview', { defaultValue: '미리보기' }) as string}
            </LinkBtn>
            <LinkBtn type="button" onClick={toggle} data-testid="mail-signature-toggle">
              {enabled
                ? t('signature.offOnce', { defaultValue: '이 메일만 빼기' }) as string
                : t('signature.onOnce', { defaultValue: '다시 넣기' }) as string}
            </LinkBtn>
          </>
        )}
        {!enabled && hasSig && <Off>{t('signature.excluded', { defaultValue: '이번 발송 제외' }) as string}</Off>}
      </Row>
      {open && hasSig && enabled && (
        // 서명 HTML 은 **저장측이 정화하지 않는다** (길이 캡만 — routes/businesses.js·email_accounts.js).
        //   작성자가 owner/admin 이라 난이도는 높지만, 렌더 시점에 정화하는 것이 정석이다.
        <Preview dangerouslySetInnerHTML={{ __html: sanitizeMailHtml(ident.signature_html) }} />
      )}
    </Wrap>
  );
}

const Wrap = styled.div`padding: 6px 0 2px;`;
const Row = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const Label = styled.span`font-size: 11px; font-weight: 600; color: #94A3B8;`;
const Src = styled.span<{ $muted: boolean }>`
  font-size: 11px; font-weight: 600;
  color: ${p => (p.$muted ? '#94A3B8' : '#0F172A')};
  background: #F1F5F9; border-radius: 10px; padding: 2px 8px;
`;
const LinkBtn = styled.button`
  background: none; border: none; padding: 2px 4px; cursor: pointer;
  font-size: 11px; font-weight: 600; color: #64748B; text-decoration: underline;
  &:hover { color: #0F172A; }
  &:focus-visible { outline: 2px solid #F43F5E; outline-offset: 2px; border-radius: 4px; }
`;
const Off = styled.span`font-size: 11px; font-weight: 600; color: #D97706;`;
const Preview = styled.div`
  margin-top: 6px; padding: 8px 10px;
  border: 1px dashed #E2E8F0; border-radius: 8px;
  background: #F8FAFC; color: #334155; font-size: 12px;
  max-height: 160px; overflow-y: auto;
  img { max-width: 100%; }
`;
