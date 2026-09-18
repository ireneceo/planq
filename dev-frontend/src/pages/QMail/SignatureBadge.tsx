// #262 — "이 메일에 붙는 서명" 표시. Irene: "서명이 팀서명과 개인서명 뭐가 붙는지도 모르고 알 수도 없어."
//
// 서명은 발송 시점에 서버가 별칭 > 계정 > 워크스페이스 순으로 고른다. 화면엔 그 결과가 전혀 없었다.
// 여기서 서버의 **같은 함수**가 계산한 결과(POST mail-outgoing-identity)를 그대로 보여준다 —
// 프론트가 우선순위를 재구현하면 실발송과 어긋나므로 절대 계산하지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import { sanitizeMailHtml } from '../../utils/sanitizeHtml';
import RichEditor from '../../components/Common/RichEditor';
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';

export type SignatureSource = 'alias' | 'account' | 'workspace' | 'none' | 'disabled';

interface Identity {
  from_name: string | null;
  from_email: string;
  signature_source: SignatureSource;
  signature_html: string | null;
  /** 이 메일에 붙을 서명의 언어 — **서버가 정한다**(본문 언어, AI 초안과 같은 detectLang). */
  signature_lang?: 'ko' | 'en';
  /** 그 언어 칸이 비어 기본 서명으로 떨어졌는가 */
  signature_lang_fallback?: boolean;
  /** 영문 서명을 저장해야 **실제로 붙는** 층. 화면이 스스로 고르지 않는다. */
  signature_target?: { layer: 'alias' | 'account' | 'workspace'; account_id: number; alias_id: number | null };
}

interface Props {
  businessId: number | null;
  /** 답장이면 스레드 id — 서버가 '받은 주소' 로 별칭을 자동 결정하는 분기를 그대로 태운다 */
  threadId?: number | null;
  accountId?: number | null;
  /** 사용자가 고른 별칭 (0 = 계정 주소 명시 선택) */
  fromAliasId?: number | null;
  /** 작성 중인 **원본 HTML** — 서명 언어 판정의 원천. 화면은 자르지도 판정하지도 않는다.
   *  ★ 발송과 **같은 함수**로 서버가 텍스트화한다(화면이 자체 stripHtml 로 잘라 보내던 탓에
   *    장문 이중언어에서 판정이 갈렸다). 전달 원문·인용문은 호출부가 빼서 넘긴다.
   *  타이핑마다 부르지 않도록 호출부에서 debounce 한 값을 넘긴다. */
  bodyHtml?: string;
  /** 새 메일의 제목. **답장(threadId)이면 넘기지 않는다** — 서버가 `Re: 원제목` 을 만든다. */
  subject?: string;
  /** 이 발송에만 서명을 붙일지 */
  enabled: boolean;
  onToggle: (next: boolean) => void;
  /** 계산된 발신 정체성을 상위로 — 발신 주소 표시를 실발송과 같은 값으로 맞추기 위해.
   *  여기서 이미 한 번 조회하므로 상위가 따로 부르지 않게 한다(중복 호출 금지). */
  onIdentity?: (ident: Identity | null) => void;
}

export default function SignatureBadge({ businessId, threadId, accountId, fromAliasId, bodyHtml, subject, enabled, onToggle, onIdentity }: Props) {
  const { t } = useTranslation('qmail');
  const [ident, setIdent] = useState<Identity | null>(null);
  // 콜백을 deps 에 넣으면 상위 렌더마다 재조회된다 — ref 로 최신 값만 참조한다.
  const onIdentityRef = useRef(onIdentity);
  onIdentityRef.current = onIdentity;
  const [open, setOpen] = useState(false);

  // ★ 저장 뒤 **다시 읽어야** 쓰던 메일에 반영된다. 그래서 조회를 함수로 뽑아 재사용한다.
  //   (서명은 발송 시점에 서버가 DB 에서 다시 고르므로, 저장만 하면 실제 발송에는 이미 적용된다 —
  //    화면이 옛 값을 보여주면 «저장했는데 안 붙는 것처럼» 보일 뿐이다.)
  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    if (!businessId) { setIdent(null); onIdentityRef.current?.(null); return; }
    let alive = true;
    // ★ **POST 로 보낸다.** 쿼리로 보내면 한글은 1자=9바이트라 1,250자쯤에서 414/431 이 나고,
    //   그 실패를 화면이 `setIdent(null)` 로 처리해 **서명 배지가 통째로 사라졌다**(Fable 실측).
    const payload: Record<string, unknown> = {};
    if (threadId) payload.thread_id = threadId;
    if (accountId) payload.account_id = accountId;
    if (fromAliasId !== null && fromAliasId !== undefined) payload.from_alias_id = fromAliasId;
    if (bodyHtml) payload.body_html = bodyHtml;
    // 답장이면 제목을 **안 보낸다** — 서버가 발송과 같은 공식으로 만든다.
    if (!threadId && subject) payload.subject = subject;
    (async () => {
      try {
        const r = await apiFetch(`/api/businesses/${businessId}/mail-outgoing-identity`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!r.ok) { if (alive) { setIdent(null); onIdentityRef.current?.(null); } return; }
        const j = await r.json();
        if (alive) { const v = j.success ? j.data : null; setIdent(v); onIdentityRef.current?.(v); }
      } catch { if (alive) { setIdent(null); onIdentityRef.current?.(null); } }
    })();
    return () => { alive = false; };
  }, [businessId, threadId, accountId, fromAliasId, bodyHtml, subject, reloadTick]);

  const toggle = useCallback(() => onToggle(!enabled), [enabled, onToggle]);

  // ── 영문 서명이 없어 한국어가 붙는 상황 — **여기서 바로 만들 수 있게** 한다.
  //   Irene: "영문서명 설정하기 해서 탭으로 열어주고 저장하면 기존 작성하던 메일에도 적용되는 여지가…"
  //   설정 화면으로 보내면 쓰던 초안을 두고 떠나야 한다. 그래서 작성창 안에서 끝낸다.
  //   저장 대상은 **서버가 알려준 층**이다 — 이긴 층이 아니면 저장해도 안 붙는다.
  const [enOpen, setEnOpen] = useState(false);
  // 쓰다 만 영문 서명은 남는다 — 컴포저를 닫아도 사라지지 않게(D-C1b 초안 등록제).
  const enDraftKey = useDraftKey('mail-signature-en', ident?.signature_target?.layer === 'alias'
    ? `alias:${ident?.signature_target?.alias_id}` : `acct:${ident?.signature_target?.account_id ?? 0}`, businessId);
  const enDraft = useDraftText(enDraftKey);
  const enHtml = enDraft.text;
  const setEnHtml = enDraft.setText;
  const [enBusy, setEnBusy] = useState(false);
  const [enErr, setEnErr] = useState<string | null>(null);
  const saveEnSignature = useCallback(async () => {
    const tgt = ident?.signature_target;
    if (!tgt || enBusy) return;
    setEnBusy(true); setEnErr(null);
    try {
      const url = tgt.layer === 'alias'
        ? `/api/businesses/${businessId}/email-accounts/${tgt.account_id}/aliases/${tgt.alias_id}`
        : tgt.layer === 'workspace'
          ? `/api/businesses/${businessId}/mail`
          : `/api/businesses/${businessId}/email-accounts/${tgt.account_id}`;
      const body = tgt.layer === 'workspace'
        ? { mail_signature_html_en: enHtml }
        : { signature_html_en: enHtml };
      const r = await apiFetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      // apiFetch 는 throw 하지 않는다 — r.ok 를 안 보면 실패해도 성공한 척 닫힌다.
      if (!r.ok || j.success === false) {
        setEnErr(t('signature.enSaveFail', { defaultValue: '저장하지 못했습니다. 권한을 확인해 주세요.' }) as string);
        return;
      }
      enDraft.clear();          // 제출 성공 — 초안을 비운다(실패하면 비우지 않는다)
      setEnOpen(false);
      setReloadTick((v) => v + 1);   // 다시 읽어 이 메일에 바로 반영
    } finally { setEnBusy(false); }
  }, [businessId, enBusy, enHtml, enDraft, ident, t]);

  if (!ident) return null;

  // 폴백 문구는 t() 안에 직접 둔다 — 객체 리터럴로 빼면 i18n 가드가 하드코딩으로 읽는다.
  // ★ 'account' 는 "그 **메일함**의 서명" 이라는 뜻이다. 회사 메일함이면 회사 서명이다.
  //   이걸 "개인 서명" 이라고 적어놔서, 회사 주소로 보내는데 "개인 서명" 이라 표시되고
  //   미리보기에는 회사 서명이 나오는 모순이 생겼다(Irene 신고).
  //   설정 화면의 계층 이름("기본 서명")과 같은 말을 쓴다 — 화면끼리 말이 달라지면 또 헷갈린다.
  const srcLabel = ({
    alias: () => t('signature.source.alias', { defaultValue: '이 주소 전용 서명' }),
    account: () => t('signature.source.account', { defaultValue: '기본 서명' }),
    workspace: () => t('signature.source.workspace', { defaultValue: '워크스페이스 서명' }),
    none: () => t('signature.source.none', { defaultValue: '서명 없음' }),
    disabled: () => t('signature.source.disabled', { defaultValue: '서명 꺼짐' }),
  })[ident.signature_source]() as string;
  const hasSig = ident.signature_source === 'alias' || ident.signature_source === 'account' || ident.signature_source === 'workspace';

  return (
    <Wrap data-testid="mail-signature-badge">
      <Row>
        <Label>{t('signature.label', { defaultValue: '서명' }) as string}</Label>
        <Src $muted={!hasSig}>{srcLabel}</Src>
        {/* 어느 주소 기준으로 고른 서명인지 같이 보여준다 — 출처 이름만으로는
            "왜 이 서명이 붙는지" 를 알 수 없어 회사/개인을 오해하게 된다. */}
        {ident.from_email && <SrcAddr>· {ident.from_email}</SrcAddr>}
        {/* ★ 2026-09-18 — 어느 **언어** 서명이 붙는지. 판정은 서버가 한 것을 그대로 보여준다
            (프론트가 다시 판정하면 실발송과 어긋난다 — 이 파일 머리말의 계약).
            언어 칸이 비어 기본으로 떨어졌으면 그 사실도 말한다 — 안 그러면
            "영문 메일인데 왜 한글 서명이지" 가 다시 신고로 온다. */}
        {hasSig && ident.signature_lang && (
          <SigLangTag $fallback={!!ident.signature_lang_fallback}>
            {ident.signature_lang === 'en'
              ? t('signature.tagEn', { defaultValue: '영문' }) as string
              : t('signature.tagKo', { defaultValue: '한국어' }) as string}
          </SigLangTag>
        )}
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
      {/* ★ 영문 메일인데 영문 서명이 없어 **한국어 서명이 붙는** 상황 — 조용히 넘기지 않는다.
          Irene: "영문서명이 비어있는데 영어로 메일 보낼 때 서명이 붙어있다면 안내해줘.
                  지금 붙어있는 서명이 한글서명이라고." 그리고 여기서 바로 만들 수 있게 한다 —
          설정 화면으로 보내면 쓰던 초안을 두고 떠나야 한다. */}
      {hasSig && ident.signature_lang === 'en' && ident.signature_lang_fallback && (
        <EnNotice>
          <EnText>{t('signature.enMissing', { defaultValue: '영문 메일인데 영문 서명이 없어 한국어 서명이 붙습니다.' }) as string}</EnText>
          <LinkBtn type="button" onClick={() => setEnOpen((v) => !v)} aria-expanded={enOpen}>
            {enOpen
              ? t('signature.enClose', { defaultValue: '닫기' }) as string
              : t('signature.enSetup', { defaultValue: '영문 서명 설정' }) as string}
          </LinkBtn>
        </EnNotice>
      )}
      {enOpen && (
        <EnEditor>
          <RichEditor
            data-draft-kind="mail-signature-en"
            value={enHtml}
            onChange={setEnHtml}
            minHeight={90}
            placeholder={t('signature.placeholderEn', { defaultValue: 'e.g. Gildong Hong · WorproLab · +82 10-0000-0000' }) as string}
          />
          {enErr && <EnErr role="alert">{enErr}</EnErr>}
          <EnFoot>
            <EnHint>{t('signature.enApplyHint', { defaultValue: '저장하면 지금 쓰는 메일부터 바로 적용됩니다.' }) as string}</EnHint>
            <SaveBtn type="button" onClick={saveEnSignature} disabled={enBusy || !enHtml.trim()}>
              {t('signature.enSave', { defaultValue: '저장' }) as string}
            </SaveBtn>
          </EnFoot>
        </EnEditor>
      )}
    </Wrap>
  );
}

const Wrap = styled.div`padding: 6px 0 2px;`;
const Row = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const Label = styled.span`font-size: 0.6875rem; font-weight: 600; color: #94A3B8;`;
const Src = styled.span<{ $muted: boolean }>`
  font-size: 0.6875rem; font-weight: 600;
  color: ${p => (p.$muted ? '#94A3B8' : '#0F172A')};
  background: #F1F5F9; border-radius: 10px; padding: 2px 8px;
`;
const SrcAddr = styled.span`font-size: 0.6875rem; color: #94A3B8; word-break: break-all;`;
const LinkBtn = styled.button`
  background: none; border: none; padding: 2px 4px; cursor: pointer;
  font-size: 0.6875rem; font-weight: 600; color: #64748B; text-decoration: underline;
  &:hover { color: #0F172A; }
  &:focus-visible { outline: 2px solid #F43F5E; outline-offset: 2px; border-radius: 4px; }
`;
const Off = styled.span`font-size: 0.6875rem; font-weight: 600; color: #D97706;`;
const Preview = styled.div`
  margin-top: 6px; padding: 8px 10px;
  border: 1px dashed #E2E8F0; border-radius: 8px;
  background: #F8FAFC; color: #334155; font-size: 0.75rem;
  max-height: 160px; overflow-y: auto;
  img { max-width: 100%; }
`;

// 서명 언어 표시 — 기본으로 떨어졌을 때는 주의색으로 «없어서 대신 붙었다» 를 드러낸다.
const SigLangTag = styled.span<{ $fallback: boolean }>`
  font-size: 0.6875rem; font-weight: 700; border-radius: 5px; padding: 1px 6px; white-space: nowrap;
  ${(p) => (p.$fallback ? 'background:#FFFBEB;color:#B45309;' : 'background:#F1F5F9;color:#475569;')}
`;

// ── 영문 서명 없음 안내 + 그 자리에서 만들기 (2026-09-18)
const EnNotice = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-top: 6px; padding: 6px 10px; border-radius: 8px;
  background: #FFFBEB; border: 1px solid #FDE68A;
`;
const EnText = styled.span`font-size: 0.6875rem; color: #B45309; font-weight: 600;`;
const EnEditor = styled.div`
  margin-top: 6px; padding: 8px; border: 1px solid #E2E8F0; border-radius: 8px; background: #fff;
`;
const EnFoot = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; flex-wrap: wrap;
`;
const EnHint = styled.span`font-size: 0.6875rem; color: #64748B;`;
const EnErr = styled.div`margin-top: 6px; font-size: 0.6875rem; color: #B91C1C;`;
const SaveBtn = styled.button`
  height: 32px; padding: 0 14px; border: none; border-radius: 8px; cursor: pointer;
  background: #14B8A6; color: #fff; font-size: 0.8125rem; font-weight: 700;
  &:disabled { background: #CBD5E1; cursor: default; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
