// 문서 변경 기록 (2026-08-25)
//
// "저장 버튼 없이 항상 저장" 의 안전망. Notion·Google Docs 가 저장 버튼 없이도 안심되는 이유가
// 이것이다 — 되돌릴 수 있으니까. 이력 없이 버튼만 없애면 "실수로 지운 문단을 되돌릴 수 없는"
// 다른 사고를 만든다.
//
// 무엇이 버전에 남는가:
//   - 본문(그 안의 이미지·파일 링크 포함) · 제목 · 분류
//   - 하단 첨부 **목록**(연결) — 복원하면 그 시점 구성으로 되돌아온다
//   - ★ 버전이 참조하는 파일은 삭제해도 디스크에서 지우지 않는다(routes/files.js softDeleteFile)
//     — 그래야 "되돌릴 수 있다" 는 약속이 지켜진다. Notion 도 같은 이유로 파일을 보관한다.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';

interface Rev {
  id: number;
  revision_number: number;
  title: string | null;
  source: 'autosave' | 'manual' | 'restore';
  editor: { id: number; name: string } | null;
  created_at: string;
}

interface Props {
  postId: number;
  open: boolean;
  onClose: () => void;
  onRestored: () => void;
}

const PostHistoryPanel: React.FC<Props> = ({ postId, open, onClose, onRestored }) => {
  const { t } = useTranslation('qdocs');
  const [revs, setRevs] = useState<Rev[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setErr(null);
    apiFetch(`/api/posts/${postId}/revisions`)
      .then(async (r) => {
        if (!r.ok) throw new Error('load_failed');   // apiFetch 는 throw 하지 않는다 — res.ok 필수
        const j = await r.json();
        if (!cancelled) setRevs(Array.isArray(j.data) ? j.data : []);
      })
      .catch(() => { if (!cancelled) setErr(t('history.loadFailed', '변경 기록을 불러오지 못했습니다') as string); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [postId, open, t]);

  if (!open) return null;

  const restore = async (rev: Rev) => {
    if (busyId) return;                       // 중복 제출 가드 (UI_DESIGN_GUIDE §1.8)
    setBusyId(rev.id); setErr(null);
    try {
      const r = await apiFetch(`/api/posts/${postId}/revisions/${rev.id}/restore`, { method: 'POST' });
      if (!r.ok) throw new Error('restore_failed');
      onRestored();
      onClose();
    } catch {
      setErr(t('history.restoreFailed', '되돌리지 못했습니다') as string);
    } finally { setBusyId(null); }
  };

  return (
    <Wrap>
      <Head>
        <HeadTitle>{t('history.title', '변경 기록')}</HeadTitle>
        <CloseBtn type="button" onClick={onClose} aria-label={t('close', '닫기') as string}>✕</CloseBtn>
      </Head>
      <Note>{t('history.attachNote', '본문·제목·분류·첨부 구성이 기록됩니다. 되돌리면 그 시점 상태로 돌아갑니다.')}</Note>
      {loading && <Empty>{t('loading', '불러오는 중…')}</Empty>}
      {err && <ErrText role="alert">{err}</ErrText>}
      {!loading && !err && revs.length === 0 && <Empty>{t('history.empty', '아직 기록이 없습니다')}</Empty>}
      <List>
        {revs.map((r, i) => (
          <Row key={r.id}>
            <RowMain>
              <RowWho>{r.editor?.name || t('history.unknown', '알 수 없음')}</RowWho>
              <RowWhen>{new Date(r.created_at).toLocaleString()}</RowWhen>
              {r.source === 'restore' && <Tag>{t('history.restored', '되돌림')}</Tag>}
              {i === 0 && <TagNow>{t('history.current', '현재')}</TagNow>}
            </RowMain>
            {i !== 0 && (
              <RestoreBtn type="button" disabled={busyId !== null} onClick={() => { void restore(r); }}>
                {busyId === r.id ? t('history.restoring', '되돌리는 중…') : t('history.restore', '이 시점으로')}
              </RestoreBtn>
            )}
          </Row>
        ))}
      </List>
    </Wrap>
  );
};

export default PostHistoryPanel;

const Wrap = styled.aside`
  width: 300px; flex-shrink: 0;
  border-left: 1px solid #E2E8F0; background: #FFF;
  display: flex; flex-direction: column; overflow: hidden;
  @media (max-width: 1024px) {
    position: fixed; top: var(--pq-mobile-chrome, 56px); right: 0; bottom: 0;
    width: min(320px, 90vw); z-index: 140; box-shadow: -12px 0 32px rgba(15,23,42,0.14);
  }
  @media (max-width: 640px) { width: 100vw; box-shadow: none; border-left: none; }
`;
const Head = styled.div`
  min-height: 56px; padding: 12px 14px; border-bottom: 1px solid #E2E8F0;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
`;
const HeadTitle = styled.h2`margin: 0; font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const CloseBtn = styled.button`
  /* touch-target-44: 폰 터치 타깃 (theme/tokens CONTROL.touchMin). 데스크탑 크기는 그대로. */
  @media (max-width: 640px) { min-width: 44px; min-height: 44px; }

  width: 36px; height: 36px; border: none; background: none; color: #64748B; cursor: pointer;
  border-radius: 8px; &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Note = styled.p`margin: 0; padding: 10px 14px; font-size: 0.71875rem; color: #94A3B8; line-height: 1.5;`;
const List = styled.div`flex: 1; min-height: 0; overflow-y: auto;`;
const Row = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 14px; border-top: 1px solid #F1F5F9;
`;
const RowMain = styled.div`display: flex; flex-direction: column; gap: 2px; min-width: 0;`;
const RowWho = styled.span`font-size: 0.8125rem; font-weight: 600; color: #0F172A;`;
const RowWhen = styled.span`font-size: 0.71875rem; color: #94A3B8;`;
const Tag = styled.span`font-size: 0.65625rem; font-weight: 700; color: #92400E; background: #FEF3C7; border-radius: 999px; padding: 1px 7px; width: fit-content;`;
const TagNow = styled(Tag)`color: #0F766E; background: #F0FDFA;`;
const RestoreBtn = styled.button`
  height: 30px; padding: 0 10px; flex-shrink: 0;
  font-size: 0.75rem; font-weight: 700; color: #0F766E;
  background: #fff; border: 1px solid #99F6E4; border-radius: 6px; cursor: pointer;
  &:hover:not(:disabled) { background: #F0FDFA; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Empty = styled.div`padding: 18px 14px; font-size: 0.78125rem; color: #94A3B8;`;
const ErrText = styled.div`padding: 10px 14px; font-size: 0.78125rem; color: #B91C1C;`;
