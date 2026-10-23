// 서명 요청 창 — «받는 분에게 함께 공개되는 것» (2026-10-05)
//   보내기 전에 무엇이 서명 링크로 열리는지(첨부·연결 문서)와 보안등급 때문에 빠지는 것을 말한다.
//   판정은 서버(services/signatureCore.planOutboundScope) — 요청 동결과 **같은 함수**라 창이 말한 것과
//   실제로 나가는 것이 갈라지지 않는다. 못 읽으면 줄을 그리지 않는다(요청은 서버가 같은 판정으로 동결한다).
//   PostSignatureModal 이 800줄을 넘지 않게 따로 둔다(god-file 래칫).
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { fetchSignatureScope, type SignatureScope } from '../../services/posts';

// vlevel·projectId — 서명 문서 공개 범위 바닥(2026-10-23 Fable): «나만 보기» 문서는 보내는 순간 서버가 L2 로 올린다.
//   창이 미리 말한다(계산은 서버 signatureCore.raisePostToSignatureFloor — 여기선 지금 값이 L1 인지만 본다).
interface Props { postId: number; open: boolean; vlevel?: string | null; projectId?: number | null; }

const SignOutboundScope: React.FC<Props> = ({ postId, open, vlevel, projectId }) => {
  const { t } = useTranslation('qdocs');
  const [scope, setScope] = useState<SignatureScope | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchSignatureScope(postId).then((sc) => { if (alive) setScope(sc); }).catch(() => { if (alive) setScope(null); });
    return () => { alive = false; };
  }, [open, postId]);

  const floorNote = vlevel === 'L1' ? (
    <FloorNote data-testid="sign-visibility-floor">
      {projectId
        ? t('sign.floor.project', { defaultValue: '서명·확인 요청을 보내면 이 문서는 «나만 보기» 로 둘 수 없습니다. 보내는 순간 프로젝트 멤버와 그 프로젝트 고객에게 보입니다.' })
        : t('sign.floor.members', { defaultValue: '서명·확인 요청을 보내면 이 문서는 «나만 보기» 로 둘 수 없습니다. 보내는 순간 서명자와 워크스페이스 대표·관리자에게 보입니다.' })}
    </FloorNote>
  ) : null;
  if (!scope) return floorNote;
  const sentFiles = scope.files.filter(f => f.included);
  const sentDocs = scope.docs.filter(d => d.included);
  const held = [
    ...scope.files.filter(f => !f.included).map(f => f.name || `#${f.file_id}`),
    ...scope.docs.filter(d => !d.included).map(d => d.title || `#${d.post_id}`),
  ];
  if (!sentFiles.length && !sentDocs.length && !held.length) return floorNote;

  return (
    <>
    {floorNote}
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
    </>
  );
};

export default SignOutboundScope;

// 모달의 Section·SectionLabel·SectionHint 와 같은 값이다(PostSignatureModal.tsx).
const Wrap = styled.section`margin-bottom: 14px;`;
const Label = styled.div`font-size: 0.75rem; font-weight: 600; color: #0F172A; margin-bottom: 6px;`;
const Line = styled.div`font-size: 0.8125rem; color: #0F172A; line-height: 1.5;`;
const Names = styled.div`font-size: 0.75rem; color: #475569; line-height: 1.5; word-break: break-word;`;
const Held = styled.div`font-size: 0.75rem; color: #B45309; background: #FFFBEB; border-radius: 6px; padding: 6px 8px; margin-top: 4px; line-height: 1.5; word-break: break-word;`;
const FloorNote = styled.div`font-size: 0.75rem; color: #B45309; background: #FFFBEB; border-radius: 6px; padding: 8px 10px; margin-bottom: 14px; line-height: 1.5; word-break: break-word;`;
const Hint = styled.div`font-size: 0.6875rem; color: #94A3B8; line-height: 1.5; margin-top: 4px;`;
