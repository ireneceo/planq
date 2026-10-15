// 문서 댓글 절 — 문서 보기 모드, 첨부 절 아래 (2026-10-15, docs/DOC_COMMENTS_DESIGN.md · Fable 설계).
//
// 목록·입력은 공용 NoteThread 를 그대로 쓴다(Q talk·메일·Q sale 메모와 같은 물건). 다른 점은 공개 범위뿐 —
//   멤버 + 고객이 있는 문서 → [팀만 | 고객도 봄], 그 밖 → 고르지 않는다(고객이 쓴 글은 서버가 shared 로 둔다).
// 누가 무엇을 보는지는 서버가 정한다(고객은 shared 만 받는다). 화면은 받은 것만 그린다.
// 실시간: `post:comment` 신호(id 만) → 열려 있는 문서와 같으면 다시 읽는다 + 탭 복귀·재연결 때 다시 읽는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import NoteThread, { type NoteItemData } from '../Common/NoteThread';
import { useAuth } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import { fetchPostComments, addPostComment, deletePostComment, type PostCommentRow, type PostCommentsResult } from '../../services/posts';

interface Props {
  postId: number;
  businessId: number;
  projectId?: number | null;
  /** 댓글 수가 바뀌면 상위(제목 옆 숫자 등)에 알린다 */
  onCount?: (n: number) => void;
}

type Row = NoteItemData & { raw: PostCommentRow };

export default function DocCommentsSection({ postId, businessId, projectId, onCount }: Props) {
  const { t } = useTranslation('qdocs');
  const { user } = useAuth();
  const { formatTimeAgo } = useTimeFormat();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<PostCommentsResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const postIdRef = useRef(postId);
  postIdRef.current = postId;

  const load = useCallback(async () => {
    const id = postId;
    try {
      const r = await fetchPostComments(id);
      if (postIdRef.current !== id) return;   // 그 사이 다른 문서로 옮겼으면 버린다
      setData(r); setFailed(false);
    } catch {
      if (postIdRef.current === id) setFailed(true);
    }
  }, [postId]);

  useEffect(() => { setData(null); void load(); }, [load]);
  useVisibilityRefresh(load);

  useEffect(() => { if (data) onCount?.(data.items.length); }, [data, onCount]);

  // 실시간 — 신호만 온다. 열려 있는 문서의 것만 다시 읽는다(250ms 묶음).
  useEffect(() => {
    let pending: number | null = null;
    const reload = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; void load(); }, 250);
    };
    const onSig = (p: { id?: number } | number) => {
      const id = typeof p === 'number' ? p : p?.id;
      if (Number(id) === postIdRef.current) reload();
    };
    // 멤버는 워크스페이스 방, 고객은 프로젝트 방(서버가 고객이면 고객 방으로 넣는다)
    const rooms = [`business:${businessId}`, ...(projectId ? [`project:${projectId}`] : [])];
    rooms.forEach(joinRoom);
    const off = onSocket('post:comment', onSig);
    const onReconnect = () => reload();
    window.addEventListener('socket:reconnected', onReconnect);
    return () => {
      if (pending) window.clearTimeout(pending);
      off(); rooms.forEach(leaveRoom);
      window.removeEventListener('socket:reconnected', onReconnect);
    };
  }, [businessId, projectId, load]);

  const isMember = data?.meta.viewer_kind !== 'client';
  const canShare = !!data?.meta.can_share_with_clients && isMember;

  const onAdd = useCallback(async (body: string, visibility: 'internal' | 'shared') => {
    if (busy) return false;
    setBusy(true);
    try {
      const row = await addPostComment(postId, body, visibility);
      setData((prev) => (prev ? { ...prev, items: [...prev.items.filter((x) => x.id !== row.id), row] } : prev));
      return true;
    } catch {
      return false;   // 쓰던 글은 남는다(초안 계약)
    } finally {
      setBusy(false);
    }
  }, [postId, busy]);

  const onDelete = useCallback(async (id: number) => {
    try {
      await deletePostComment(postId, id);
      setData((prev) => (prev ? { ...prev, items: prev.items.filter((x) => x.id !== id) } : prev));
    } catch { void load(); }
  }, [postId, load]);

  const rows: Row[] = (data?.items || []).map((c) => ({
    id: c.id, body: c.content, visibility: c.visibility, author_user_id: c.user_id,
    author_name: c.author_name, created_at: c.created_at, raw: c,
  }));
  const hl = Number(searchParams.get('comment')) || null;
  const hlPost = Number(searchParams.get('post')) || null;

  return (
    <Section data-testid="doc-comments-section">
      <Title>
        {t('comments.title', '댓글')}
        {data && data.items.length > 0 && <Count>{data.items.length}</Count>}
      </Title>
      {failed && !data ? (
        <ErrorLine>
          {t('comments.loadFailed', '댓글을 불러오지 못했습니다')}
          {' · '}
          <RetryBtn type="button" onClick={() => void load()}>{t('comments.retry', '다시 시도')}</RetryBtn>
        </ErrorLine>
      ) : (
        <NoteThread
          notes={rows}
          myUserId={user?.id != null ? Number(user.id) : null}
          canChooseVisibility={canShare}
          visibilityOptions={[
            { value: 'internal' as const, label: t('comments.vis.internal', '팀만') as string },
            { value: 'shared' as const, label: t('comments.vis.shared', '고객도 봄') as string },
          ]}
          busy={busy || !data}
          onAdd={onAdd}
          onDelete={onDelete}
          canDelete={(n) => !!(n as Row).raw?.can_delete}
          formatTime={formatTimeAgo}
          emptyText={t('comments.empty', '아직 댓글이 없습니다') as string}
          placeholder={t('comments.placeholder', '댓글을 남기세요 (Enter 전송 · Shift+Enter 줄바꿈)') as string}
          listMaxHeight="none"
          highlightId={hlPost === postId ? hl : null}
          renderMeta={(n) => {
            const r = (n as Row).raw;
            if (!r) return null;
            return (
              <>
                {r.author_kind === 'client' && <Chip data-testid="doc-comment-chip-client">{t('comments.chip.client', '고객')}</Chip>}
                {isMember && r.visibility === 'shared' && <Chip data-testid="doc-comment-chip-shared">{t('comments.chip.shared', '고객도 봄')}</Chip>}
              </>
            );
          }}
          draftKind="post-comment"
          draftEntityId={postId}
          draftBizId={businessId}
        />
      )}
    </Section>
  );
}

const Section = styled.section`
  margin-top: 12px;
  padding-top: 16px;
  border-top: 1px solid #E2E8F0;
  display: flex; flex-direction: column; gap: 10px;
`;
const Title = styled.div`
  display: flex; align-items: center; gap: 6px;
  font-size: 0.8125rem; font-weight: 700; color: #334155;
`;
const Count = styled.span`
  padding: 1px 7px; border-radius: 999px;
  font-size: 0.6875rem; font-weight: 700; line-height: 1.5; text-align: center;
  color: #475569; background: #F1F5F9;
`;
const Chip = styled.span`
  display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px;
  font-size: 0.625rem; font-weight: 700; line-height: 1.6;
  color: #475569; background: #E2E8F0;
`;
const ErrorLine = styled.div`font-size: 0.75rem; color: #64748B;`;
const RetryBtn = styled.button`
  border: none; background: none; padding: 0; cursor: pointer;
  font-size: 0.75rem; color: #0F766E; text-decoration: underline;
`;
