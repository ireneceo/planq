// 문서 변경 기록 (2026-08-25 · 2026-10-12 다시 만듦)
//
// "저장 버튼 없이 항상 저장" 의 안전망. Notion·Google Docs 가 저장 버튼 없이도 안심되는 이유가
// 이것이다 — 되돌릴 수 있으니까.
//
// 2026-10-12 (Irene: "수정한 일시랑 수정한 사람 저장되고 되돌리는거 되는지 확인하고 제대로 구성된 ui/ux인지")
//   옛 화면은 누가·언제만 보여 주고 [이 시점으로] 를 누르면 **확인도 미리보기도 없이** 본문을 통째로 갈아끼웠다.
//   무엇으로 돌아가는지 모르고 누르는 버튼이었다(버전 본문 API 는 있었는데 아무도 안 불렀다).
//   → 우측 표준 패널(DetailDrawer) · 행마다 무엇이 바뀌었나(제목·분류·글자 수) · 눌러서 그 버전 미리보기 ·
//     되돌리기는 확인창(지금 내용은 기록에 남는다고 말한다) · 되돌린 뒤 목록 맨 위 «현재 · 되돌림» 이 결과를 말한다.
//
// 무엇이 버전에 남는가:
//   - 본문(그 안의 이미지·파일 링크 포함) · 제목 · 분류 · 하단 첨부 **목록**(연결)
//   - ★ 표 문서의 칸 내용은 버전 대상이 아니다(표는 줄 단위로 따로 저장된다) — 화면이 그렇게 말한다.
//   - 같은 사람이 10분 안에 이어 쓴 저장은 한 버전으로 합쳐진다(시각 = 그 묶음의 마지막 저장).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { formatDayTime } from '../../utils/dateFormat';
import DetailDrawer from '../Common/DetailDrawer';
import ActionButton from '../Common/ActionButton';
import ConfirmDialog from '../Common/ConfirmDialog';
import PostEditor from './PostEditor';

interface Rev {
  id: number;
  revision_number: number;
  title: string | null;
  source: 'autosave' | 'manual' | 'restore';
  editor: { id: number; name: string } | null;
  created_at: string;
  saved_at: string;
  text_len: number;
  text_delta: number | null;
  title_changed: boolean;
  category_changed: boolean;
  is_first: boolean;
}

interface RevDetail {
  id: number;
  revision_number: number;
  title: string | null;
  category: string | null;
  content_json: unknown;
  editor: { id: number; name: string } | null;
  saved_at: string;
}

interface Props {
  postId: number;
  open: boolean;
  isTable?: boolean;
  onClose: () => void;
  onRestored: () => void;
}

const PostHistoryPanel: React.FC<Props> = ({ postId, open, isTable = false, onClose, onRestored }) => {
  const { t } = useTranslation('qdocs');
  const [revs, setRevs] = useState<Rev[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const [detail, setDetail] = useState<RevDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await apiFetch(`/api/posts/${postId}/revisions`);
      if (!r.ok) throw new Error('load_failed');   // apiFetch 는 throw 하지 않는다 — res.ok 필수
      const j = await r.json();
      setRevs(Array.isArray(j.data) ? j.data : []);
    } catch {
      setErr(t('history.loadFailed', '변경 기록을 불러오지 못했습니다') as string);
    } finally { setLoading(false); }
  }, [postId, t]);

  useEffect(() => {
    if (!open) { setSelId(null); setDetail(null); return; }
    void load();
  }, [open, load]);

  // 고른 버전 본문 — 목록에는 본문을 싣지 않으므로 누를 때 읽는다.
  useEffect(() => {
    if (!open || selId == null) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true); setErr(null);
    apiFetch(`/api/posts/${postId}/revisions/${selId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('detail_failed');
        const j = await r.json();
        if (!cancelled) setDetail(j.data || null);
      })
      .catch(() => { if (!cancelled) setErr(t('history.previewFailed', '이 버전을 불러오지 못했습니다') as string); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [open, selId, postId, t]);

  const currentId = revs[0]?.id ?? null;
  const sel = revs.find((r) => r.id === selId) || null;
  const isCurrent = sel != null && sel.id === currentId;
  const whoOf = (r: { editor: { name: string } | null } | null) => r?.editor?.name || (t('history.unknown', '알 수 없음') as string);
  const whenOf = (v: string | undefined) => formatDayTime(v, { year: 'always' });

  // 재클릭 = 선택 해제 (리스트 공통 규칙)
  const pick = (id: number) => setSelId((cur) => (cur === id ? null : id));

  const doRestore = async () => {
    if (!sel || busy) return;                 // 중복 제출 가드 (UI_DESIGN_GUIDE §1.8)
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`/api/posts/${postId}/revisions/${sel.id}/restore`, { method: 'POST' });
      if (!r.ok) {
        setErr(r.status === 409
          ? t('history.restoreLocked', '서명이 진행된 문서는 되돌릴 수 없습니다') as string
          : t('history.restoreFailed', '되돌리지 못했습니다') as string);
        return;
      }
      setConfirmOpen(false);
      setSelId(null);
      onRestored();
      await load();                            // 맨 위에 «현재 · 되돌림» 이 결과를 말한다(성공 토스트 금지)
    } catch {
      setErr(t('history.restoreFailed', '되돌리지 못했습니다') as string);
    } finally { setBusy(false); }
  };

  const changeSummary = (r: Rev): string[] => {
    const out: string[] = [];
    if (r.is_first) return out;
    if (r.title_changed) out.push(t('history.titleChanged', '제목 변경') as string);
    if (r.category_changed) out.push(t('history.categoryChanged', '분류 변경') as string);
    if (r.text_delta != null && r.text_delta !== 0) {
      out.push(r.text_delta > 0
        ? t('history.charsAdded', { count: r.text_delta, defaultValue: '+{{count}}자' }) as string
        : t('history.charsRemoved', { count: -r.text_delta, defaultValue: '−{{count}}자' }) as string);
    }
    return out;
  };

  return (
    <DetailDrawer open={open} onClose={onClose} ariaLabel={t('history.title', '변경 기록') as string}>
      <DetailDrawer.Header onClose={onClose}>
        <HeadTitle>{t('history.title', '변경 기록')}</HeadTitle>
      </DetailDrawer.Header>
      <DetailDrawer.Body>
        <div data-testid="post-history-panel">
          {sel ? (
            <>
              <BackLink type="button" onClick={() => setSelId(null)} data-testid="post-history-back">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                {t('history.backToList', '모든 기록')}
              </BackLink>
              <PreviewMeta>
                <MetaWho>{whoOf(sel)}</MetaWho>
                <MetaWhen>{whenOf(sel.saved_at)}</MetaWhen>
                {isCurrent && <TagNow>{t('history.current', '현재')}</TagNow>}
                {sel.is_first && <TagFirst>{t('history.first', '처음 버전')}</TagFirst>}
              </PreviewMeta>
              {err && <ErrText role="alert">{err}</ErrText>}
              {detailLoading && <Empty>{t('history.loading', '불러오는 중…')}</Empty>}
              {detail && !detailLoading && (
                <PreviewBox data-testid="post-history-preview">
                  <PreviewTitle>{detail.title || t('history.untitled', '(제목 없음)')}</PreviewTitle>
                  {detail.category && <PreviewCat>{detail.category}</PreviewCat>}
                  <PostEditor value={detail.content_json} onChange={() => {}} editable={false} borderless />
                </PreviewBox>
              )}
              {isTable && <Note>{t('history.tableNote', '표의 칸 내용은 버전에 들어가지 않습니다 — 제목·설명·분류·첨부만 되돌아갑니다.')}</Note>}
            </>
          ) : (
            <>
              <Note>
                {t('history.note2', '저장할 때마다 누가·언제 고쳤는지 남습니다. 같은 사람이 10분 안에 이어 고친 것은 한 버전으로 묶입니다. 버전을 눌러 내용을 보고 되돌릴 수 있습니다.')}
                {isTable && <> {t('history.tableNote', '표의 칸 내용은 버전에 들어가지 않습니다 — 제목·설명·분류·첨부만 되돌아갑니다.')}</>}
              </Note>
              {loading && revs.length === 0 && <Empty>{t('history.loading', '불러오는 중…')}</Empty>}
              {err && <ErrText role="alert">{err}</ErrText>}
              {!loading && !err && revs.length === 0 && (
                <Empty>{t('history.empty2', '아직 고친 기록이 없습니다. 처음 고칠 때 지금 내용이 «처음 버전» 으로 남습니다.')}</Empty>
              )}
              <List role="list">
                {revs.map((r) => {
                  const chips = changeSummary(r);
                  return (
                    <Row key={r.id} role="listitem">
                      <RowBtn type="button" onClick={() => pick(r.id)} data-testid={`post-history-row-${r.revision_number}`}>
                        <RowTop>
                          <RowWho>{whoOf(r)}</RowWho>
                          {r.id === currentId && <TagNow>{t('history.current', '현재')}</TagNow>}
                          {r.source === 'restore' && <Tag>{t('history.restored', '되돌림')}</Tag>}
                          {r.is_first && <TagFirst>{t('history.first', '처음 버전')}</TagFirst>}
                        </RowTop>
                        <RowWhen>{whenOf(r.saved_at)}</RowWhen>
                        {chips.length > 0 && <RowChange>{chips.join(' · ')}</RowChange>}
                      </RowBtn>
                    </Row>
                  );
                })}
              </List>
            </>
          )}
        </div>
      </DetailDrawer.Body>
      {sel && !isCurrent && (
        <DetailDrawer.Footer>
          <ActionButton tone="primary" size="md" onClick={() => setConfirmOpen(true)} disabled={!detail || busy} data-testid="post-history-restore">
            {t('history.restoreThis', '이 버전으로 되돌리기')}
          </ActionButton>
        </DetailDrawer.Footer>
      )}
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => { if (!busy) setConfirmOpen(false); }}
        onConfirm={() => { void doRestore(); }}
        variant="warning"
        title={t('history.confirmTitle', '이 버전으로 되돌릴까요?') as string}
        message={t('history.confirmMsg', {
          who: whoOf(sel), when: whenOf(sel?.saved_at),
          defaultValue: '{{when}} · {{who}} 님이 저장한 버전으로 문서를 바꿉니다.\n지금 내용은 기록에 남아 언제든 다시 되돌릴 수 있습니다.',
        }) as string}
        confirmText={busy ? t('history.restoring', '되돌리는 중…') as string : t('history.restoreThis', '이 버전으로 되돌리기') as string}
        cancelText={t('cancel', '취소') as string}
      />
    </DetailDrawer>
  );
};

export default PostHistoryPanel;

const HeadTitle = styled.h2`margin: 0; font-size: 1rem; font-weight: 700; color: #0F172A;`;
const Note = styled.p`margin: 0 0 12px; font-size: 0.75rem; color: #64748B; line-height: 1.55;`;
const List = styled.div`display: flex; flex-direction: column; border-top: 1px solid #F1F5F9;`;
const Row = styled.div`border-bottom: 1px solid #F1F5F9;`;
const RowBtn = styled.button`
  width: 100%; text-align: left; background: none; border: none; cursor: pointer;
  display: flex; flex-direction: column; gap: 3px; padding: 11px 6px; border-radius: 8px;
  &:hover { background: #F8FAFC; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: -2px; }
  @media (max-width: 640px) { min-height: 56px; }
`;
const RowTop = styled.div`display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap;`;
const RowWho = styled.span`font-size: 0.8125rem; font-weight: 600; color: #0F172A;`;
const RowWhen = styled.span`font-size: 0.75rem; color: #64748B;`;
const RowChange = styled.span`font-size: 0.71875rem; color: #94A3B8;`;
const Tag = styled.span`font-size: 0.65625rem; font-weight: 700; color: #92400E; background: #FEF3C7; border-radius: 999px; padding: 1px 7px; width: fit-content;`;
const TagNow = styled(Tag)`color: #0F766E; background: #F0FDFA;`;
const TagFirst = styled(Tag)`color: #475569; background: #F1F5F9;`;
const BackLink = styled.button`
  display: inline-flex; align-items: center; gap: 4px; margin: 0 0 10px; padding: 0 8px 0 2px; height: 32px;
  font-size: 0.8125rem; font-weight: 600; color: #475569; background: none; border: none; border-radius: 6px; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
  @media (max-width: 640px) { height: 40px; }
`;
const PreviewMeta = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;`;
const MetaWho = styled.span`font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const MetaWhen = styled.span`font-size: 0.8125rem; color: #64748B;`;
const PreviewBox = styled.div`
  border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px; background: #FFF;
  margin-bottom: 12px; overflow-x: auto;
`;
const PreviewTitle = styled.div`font-size: 1rem; font-weight: 700; color: #0F172A; margin-bottom: 4px; word-break: break-word;`;
const PreviewCat = styled.div`font-size: 0.75rem; color: #64748B; margin-bottom: 8px;`;
const Empty = styled.div`padding: 18px 4px; font-size: 0.78125rem; color: #94A3B8; line-height: 1.5;`;
const ErrText = styled.div`padding: 8px 0; font-size: 0.78125rem; color: #B91C1C;`;
