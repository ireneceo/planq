// 서명 화면의 «연결 문서» (2026-10-05) — 서명 요청 때 동결한 관련 문서를 서명자가 연다.
//   본문이 "관련 문서 참조" 를 말하는데 서명자는 그 문서를 볼 길이 없었다. 별첨(파일)과 같은 자리·같은 모양.
//   본문은 GET /api/sign/:token/linked/:postId 가 **동결본**으로 준다(원본을 읽지 않는다).
//   펼치면 그 자리에서 읽는다 — 새 창으로 보내면 무인증 서명 화면 밖의 앱 주소로 가게 된다.
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { sanitizeRichText } from '../../utils/sanitizeHtml';
import { withImageCtxHtml } from '../../utils/imageCtx';
import { AttachBox, AttachTitle, AttachRow, AttachIcon, AttachName, SignedHtml } from './PublicSignPage.styles';

interface Props {
  token: string;
  docs: { post_id: number; title: string }[];
  imageCtx?: string | null;
}

type Loaded = { state: 'loading' } | { state: 'error' } | { state: 'ok'; html: string };

const SignLinkedDocs: React.FC<Props> = ({ token, docs, imageCtx }) => {
  const { t } = useTranslation('qdocs');
  const [openId, setOpenId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<Record<number, Loaded>>({});

  const toggle = async (id: number) => {
    if (openId === id) { setOpenId(null); return; }   // 재클릭 토글
    setOpenId(id);
    if (loaded[id]?.state === 'ok') return;
    setLoaded((m) => ({ ...m, [id]: { state: 'loading' } }));
    try {
      const r = await fetch(`/api/sign/${token}/linked/${id}`);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) throw new Error('load_failed');
      setLoaded((m) => ({ ...m, [id]: { state: 'ok', html: String(j.data?.html || '') } }));
    } catch {
      setLoaded((m) => ({ ...m, [id]: { state: 'error' } }));
    }
  };

  if (!docs.length) return null;
  return (
    <AttachBox data-testid="sign-linked-docs">
      <AttachTitle>
        {t('publicSign.linkedDocs', { defaultValue: '연결 문서 {{n}}건 — 이 문서와 함께 보내졌습니다', n: docs.length }) as string}
      </AttachTitle>
      {docs.map((d) => {
        const st = loaded[d.post_id];
        const isOpen = openId === d.post_id;
        return (
          <div key={d.post_id}>
            <AttachRow as="button" type="button" onClick={() => { void toggle(d.post_id); }}
              aria-expanded={isOpen} data-testid="sign-linked-doc">
              <AttachIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
              </AttachIcon>
              <AttachName>{d.title || `#${d.post_id}`}</AttachName>
              <Chevron $open={isOpen} aria-hidden="true">›</Chevron>
            </AttachRow>
            {isOpen && (
              <LinkedBody data-testid="sign-linked-body">
                {(!st || st.state === 'loading') && <Muted>{t('publicSign.linkedLoading', { defaultValue: '불러오는 중…' }) as string}</Muted>}
                {st?.state === 'error' && <Muted>{t('publicSign.linkedError', { defaultValue: '문서를 열지 못했습니다. 잠시 후 다시 눌러 주세요.' }) as string}</Muted>}
                {st?.state === 'ok' && (
                  <SignedHtml dangerouslySetInnerHTML={{ __html: sanitizeRichText(withImageCtxHtml(st.html, imageCtx) || '') }} />
                )}
              </LinkedBody>
            )}
          </div>
        );
      })}
    </AttachBox>
  );
};

export default SignLinkedDocs;

const Chevron = styled.span<{ $open: boolean }>`
  flex-shrink: 0; color: #94A3B8; font-size: 1rem; line-height: 1;
  transform: rotate(${(p) => (p.$open ? '90deg' : '0deg')}); transition: transform 0.15s;
`;
const LinkedBody = styled.div`
  margin: -2px 0 10px; padding: 14px 16px;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #F8FAFC;
  overflow-x: auto;
`;
const Muted = styled.div`font-size: 0.8125rem; color: #64748B;`;
