// 채팅에서 공유받은 문서 카드 클릭 시 팝업 미리보기
// 본문 읽기전용 + "문서로 가서 보기" 버튼
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PostEditor from '../../components/Docs/PostEditor';
import { fetchPost, type PostDetail } from '../../services/posts';
import type { PostCardMeta } from './mock';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';

interface Props {
  card: PostCardMeta;
  onClose: () => void;
}

const PostCardPreviewModal: React.FC<Props> = ({ card, onClose }) => {
  const { t } = useTranslation('qtalk');
  const navigate = useNavigate();
  const [doc, setDoc] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleted, setDeleted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useBodyScrollLock(true);
  useEscapeStack(true, onClose);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPost(card.post_id)
      .then(d => {
        if (cancelled) return;
        if (d) {
          setDoc(d);
        } else {
          // fetchPost 가 null 반환 = 404 또는 403. 삭제된 문서로 간주
          setDeleted(true);
        }
      })
      .catch(e => { if (!cancelled) setErr((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [card.post_id]);

  return (
    <Backdrop onClick={onClose}>
      <Dialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={card.title}>
        <Header>
          <Title>{doc?.title || card.title}</Title>
          <HeaderActions>
            {doc && (
              <OpenBtn type="button" onClick={() => { navigate(`/docs?post=${card.post_id}`); onClose(); }}>
                {t('chat.card.openFull', '문서로 가서 보기')}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4 }}><path d="M7 17L17 7"/><polyline points="7 7 17 7 17 17"/></svg>
              </OpenBtn>
            )}
            <CloseBtn type="button" onClick={onClose} aria-label={t('common.close', '닫기') as string}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </CloseBtn>
          </HeaderActions>
        </Header>
        <Body>
          {loading ? (
            <Center>{t('chat.card.loading', '문서 로드 중...')}</Center>
          ) : deleted ? (
            <DeletedState>
              <DeletedIcon>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </DeletedIcon>
              <DeletedTitle>{t('chat.card.deleted', '이 문서는 삭제되어 더 이상 볼 수 없습니다')}</DeletedTitle>
              <DeletedHint>{t('chat.card.deletedHint', '문서가 삭제되거나 접근 권한이 없습니다.')}</DeletedHint>
            </DeletedState>
          ) : err ? (
            <Center>{err}</Center>
          ) : doc ? (
            <>
              <Meta>
                <span>{doc.author?.name || '—'}</span>
                {doc.project && <><span>·</span><span>{doc.project.name}</span></>}
              </Meta>
              <PostEditor value={doc.content_json} onChange={() => {}} editable={false} />
            </>
          ) : null}
        </Body>
      </Dialog>
    </Backdrop>
  );
};

export default PostCardPreviewModal;

const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.55);
  display: flex; align-items: center; justify-content: center; z-index: 1100;
  padding: 24px;
`;
const Dialog = styled.div`
  background: #fff; border-radius: 14px; width: 100%; max-width: 760px;
  max-height: 86vh; display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
  @media (max-width: 640px) {
    max-height: 100vh; border-radius: 0; max-width: 100vw;
  }
`;
const Header = styled.div`
  display: flex; align-items: center; gap: 12px;
  padding: 14px 18px; border-bottom: 1px solid #F1F5F9;
`;
const Title = styled.h2`
  flex: 1; font-size: 16px; font-weight: 700; color: #0F172A; margin: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const HeaderActions = styled.div`display:flex;align-items:center;gap:6px;flex-shrink:0;`;
const OpenBtn = styled.button`
  display: inline-flex; align-items: center; padding: 7px 12px;
  font-size: 12px; font-weight: 700; color: #fff; background: #14B8A6;
  border: none; border-radius: 8px; cursor: pointer;
  &:hover { background: #0D9488; }
`;
const CloseBtn = styled.button`
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px; cursor: pointer; color: #64748B;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Body = styled.div`
  flex: 1; overflow-y: auto; padding: 20px 28px 28px;
  font-size: 14px; line-height: 1.7; color: #0F172A;
`;
const Meta = styled.div`
  display: flex; align-items: center; gap: 6px; font-size: 12px; color: #64748B;
  margin-bottom: 16px;
`;
const Center = styled.div`
  min-height: 200px; display: flex; align-items: center; justify-content: center;
  color: #64748B; font-size: 14px;
`;
const DeletedState = styled.div`
  min-height: 240px; padding: 32px 16px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  text-align: center;
`;
const DeletedIcon = styled.div`
  width: 56px; height: 56px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA;
  margin-bottom: 4px;
`;
const DeletedTitle = styled.div`font-size:14px;font-weight:700;color:#0F172A;`;
const DeletedHint = styled.div`font-size:12px;color:#64748B;line-height:1.5;max-width:320px;`;
