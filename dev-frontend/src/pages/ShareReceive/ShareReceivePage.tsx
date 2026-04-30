// 사이클 Q-D Phase 3 — PWA Share Target 수신 페이지.
//
// manifest.json 의 share_target.action='/share-receive' (GET, params: title/text/url)
// 외부 앱(카톡·갤러리·브라우저) "공유" → PlanQ 선택 시 이 페이지 진입.
//
// 흐름:
//   1) URL 쿼리 파싱 (title / text / url)
//   2) 사용자에게 "어디로 보낼까요?" 선택 UI (대화방·업무·메모·문서)
//   3) 선택 → 해당 영역의 신규 작성 화면으로 이동, content prefill

import React, { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';

const ShareReceivePage: React.FC = () => {
  const { t } = useTranslation('common');
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const title = params.get('title') || '';
  const text = params.get('text') || '';
  const url = params.get('url') || '';

  const content = useMemo(() => {
    const parts: string[] = [];
    if (title) parts.push(title);
    if (text) parts.push(text);
    if (url) parts.push(url);
    return parts.filter(Boolean).join('\n');
  }, [title, text, url]);

  const sendTo = (target: 'chat' | 'task' | 'note' | 'doc') => {
    const encoded = encodeURIComponent(content);
    switch (target) {
      case 'chat':  navigate(`/talk?prefill=${encoded}`); break;
      case 'task':  navigate(`/tasks?prefill=${encoded}`); break;
      case 'note':  navigate(`/qnote?prefill=${encoded}`); break;
      case 'doc':   navigate(`/docs?prefill=${encoded}`); break;
    }
  };

  return (
    <PageShell title={t('shareReceive.title', 'PlanQ 로 공유') as string}>
      <Wrap>
        <PreviewBox>
          <PreviewLabel>{t('shareReceive.received', '받은 내용')}</PreviewLabel>
          <PreviewContent>{content || t('shareReceive.empty', '(빈 내용)')}</PreviewContent>
        </PreviewBox>

        <ChooseLabel>{t('shareReceive.chooseDest', '어디로 보낼까요?')}</ChooseLabel>
        <DestGrid>
          <DestBtn type="button" onClick={() => sendTo('chat')}>
            <DestIcon>💬</DestIcon>
            <DestTitle>{t('shareReceive.dest.chat', '채팅')}</DestTitle>
            <DestDesc>{t('shareReceive.dest.chatDesc', '대화방에 메시지로')}</DestDesc>
          </DestBtn>
          <DestBtn type="button" onClick={() => sendTo('task')}>
            <DestIcon>✓</DestIcon>
            <DestTitle>{t('shareReceive.dest.task', '업무')}</DestTitle>
            <DestDesc>{t('shareReceive.dest.taskDesc', '새 업무로 등록')}</DestDesc>
          </DestBtn>
          <DestBtn type="button" onClick={() => sendTo('note')}>
            <DestIcon>📝</DestIcon>
            <DestTitle>{t('shareReceive.dest.note', '메모')}</DestTitle>
            <DestDesc>{t('shareReceive.dest.noteDesc', 'Q Note 에 저장')}</DestDesc>
          </DestBtn>
          <DestBtn type="button" onClick={() => sendTo('doc')}>
            <DestIcon>📄</DestIcon>
            <DestTitle>{t('shareReceive.dest.doc', '문서')}</DestTitle>
            <DestDesc>{t('shareReceive.dest.docDesc', '새 문서 본문에')}</DestDesc>
          </DestBtn>
        </DestGrid>

        <Hint>
          {t(
            'shareReceive.hint',
            '파일·이미지 공유는 다음 업데이트에서 지원됩니다. 지금은 PlanQ 안에서 직접 첨부해주세요.',
          )}
        </Hint>
      </Wrap>
    </PageShell>
  );
};

export default ShareReceivePage;

const Wrap = styled.div`max-width: 560px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px;`;
const PreviewBox = styled.div`background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px;`;
const PreviewLabel = styled.div`font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px;`;
const PreviewContent = styled.div`font-size: 13px; color: #0F172A; white-space: pre-wrap; word-break: break-word; line-height: 1.5;`;
const ChooseLabel = styled.h3`font-size: 14px; font-weight: 700; color: #0F172A; margin: 0;`;
const DestGrid = styled.div`display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;`;
const DestBtn = styled.button`
  display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
  padding: 16px; min-height: 100px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  text-align: left; cursor: pointer; transition: all 0.15s;
  &:hover { background: #F0FDFA; border-color: #14B8A6; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(20,184,166,0.3); }
`;
const DestIcon = styled.span`font-size: 24px; line-height: 1;`;
const DestTitle = styled.div`font-size: 14px; font-weight: 700; color: #0F172A;`;
const DestDesc = styled.div`font-size: 11px; color: #64748B;`;
const Hint = styled.div`font-size: 11px; color: #94A3B8; padding: 8px 0; line-height: 1.5;`;
