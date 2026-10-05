// 서명 요청 창 — «받는 분에게 함께 공개되는 것» (2026-10-05)
//   보내기 전에 무엇이 서명 링크로 열리는지(첨부·연결 문서)와 보안등급 때문에 빠지는 것을 말한다.
//   판정은 서버(services/signatureCore.planOutboundScope) — 요청 동결과 **같은 함수**라 창이 말한 것과
//   실제로 나가는 것이 갈라지지 않는다. 못 읽으면 줄을 그리지 않는다(요청은 서버가 같은 판정으로 동결한다).
//   PostSignatureModal 이 800줄을 넘지 않게 따로 둔다(god-file 래칫).
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { fetchSignatureScope, type SignatureScope } from '../../services/posts';

interface Props { postId: number; open: boolean; }

const SignOutboundScope: React.FC<Props> = ({ postId, open }) => {
  const { t } = useTranslation('qdocs');
  const [scope, setScope] = useState<SignatureScope | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchSignatureScope(postId).then((sc) => { if (alive) setScope(sc); }).catch(() => { if (alive) setScope(null); });
    return () => { alive = false; };
  }, [open, postId]);

  if (!scope) return null;
  const sentFiles = scope.files.filter(f => f.included);
  const sentDocs = scope.docs.filter(d => d.included);
  const held = [
    ...scope.files.filter(f => !f.included).map(f => f.name || `#${f.file_id}`),
    ...scope.docs.filter(d => !d.included).map(d => d.title || `#${d.post_id}`),
  ];
  if (!sentFiles.length && !sentDocs.length && !held.length) return null;

  return (
    <Wrap data-testid="sign-outbound-scope">
      <Label>{t('sign.scope.label', { defaultValue: '받는 분에게 함께 공개되는 것' })}</Label>
      <Line>{t('sign.scope.counts', { defaultValue: '첨부 파일 {{files}}건 · 연결 문서 {{docs}}건', files: sentFiles.length, docs: sentDocs.length })}</Line>
      {sentDocs.length > 0 && <Names>{sentDocs.map(d => d.title || `#${d.post_id}`).join(', ')}</Names>}
      {held.length > 0 && (
        <Held data-testid="sign-outbound-held">
          {t('sign.scope.held', { defaultValue: '보안등급(내부·기밀)이라 보내지 않습니다: {{names}}', names: held.join(', ') })}
        </Held>
      )}
      <Hint>{t('sign.scope.hint', { defaultValue: '지금 내용으로 고정되어 서명 링크에서 열립니다. 이후 원본을 고쳐도 받는 분이 보는 것은 바뀌지 않습니다.' })}</Hint>
    </Wrap>
  );
};

export default SignOutboundScope;

// 모달의 Section·SectionLabel·SectionHint 와 같은 값이다(PostSignatureModal.tsx).
const Wrap = styled.section`margin-bottom: 14px;`;
const Label = styled.div`font-size: 0.75rem; font-weight: 600; color: #0F172A; margin-bottom: 6px;`;
const Line = styled.div`font-size: 0.8125rem; color: #0F172A; line-height: 1.5;`;
const Names = styled.div`font-size: 0.75rem; color: #475569; line-height: 1.5; word-break: break-word;`;
const Held = styled.div`font-size: 0.75rem; color: #B45309; background: #FFFBEB; border-radius: 6px; padding: 6px 8px; margin-top: 4px; line-height: 1.5; word-break: break-word;`;
const Hint = styled.div`font-size: 0.6875rem; color: #94A3B8; line-height: 1.5; margin-top: 4px;`;
