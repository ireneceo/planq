// NotesTab — 프로젝트에 연결된 **Q Note 회의록** 목록.
//
// ★ 2026-09-13 (Irene: *"상단에 문서 다음에 노트 넣어줘. 노트는 Q note가 프로젝트로 연결되면
//   잡히는 거야."* · *"프로젝트 > 노트 탭은 문서 랑 완전히 똑같이 해서 Q note 기능 그대로 구현해."*)
//
// ★ 범위는 서버(q-note)가 정한다 — `visibility <> 'L1'`. **개인 노트는 오지 않는다.**
//   프로젝트에 연결했다는 것과 남이 읽어도 된다는 것은 다르다(PERMISSION_MATRIX §5.8).
//   그래서 "안 보이는 노트가 있다" 가 정상이고, 화면이 그 이유를 말한다.
//
// ★ 여는 것은 **Q Note 본체**다(새 탭). 회의록 화면은 녹음·요약·화자·업무추출이 붙은 5000줄짜리
//   페이지라 여기 베껴 그리면 반드시 갈라진다 — 목록은 여기서, 내용은 거기서.
import { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { tabStore } from '../../stores/tabStore';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import SearchBox from '../../components/Common/SearchBox';
import HighlightText from '../../components/Common/HighlightText';
import ActionButton from '../../components/Common/ActionButton';

interface NoteRow {
  id: number;
  title: string | null;
  user_id: number;
  created_at: string;
  status: string;
  capture_mode: string;
}

export default function NotesTab({ projectId }: { projectId: number }) {
  const { t } = useTranslation('qproject');
  const { formatDateTime } = useTimeFormat();
  const [rows, setRows] = useState<NoteRow[] | null>(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setError(false);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/notes?limit=100`);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setError(true); setRows([]); return; }
      setRows(Array.isArray(j.data) ? j.data : []);
    } catch { setError(true); setRows([]); }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);
  // Q Note 는 별도 서비스라 소켓이 없다 — 탭 복귀 때 다시 읽는다(운영 안정성 16 (d))
  useVisibilityRefresh(load);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!rows) return [];
    if (!q) return rows;
    return rows.filter((n) => (n.title || '').toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <Wrap>
      <Toolbar>
        <SearchBox value={search} onChange={setSearch}
          placeholder={t('qnote.searchPlaceholder', '회의록 제목 검색') as string} />
        <Spacer />
        {/* 새 회의록은 Q Note 에서 만든다 — 여기 또 만드는 문을 두면 두 벌이 된다 */}
        <ActionButton tone="secondary" size="sm" data-testid="project-notes-open-qnote"
          onClick={() => tabStore.openInNewTab('/notes')}>
          {t('qnote.openQNote', 'Q note 에서 열기') as string}
        </ActionButton>
      </Toolbar>

      {rows === null ? (
        <Dim>{t('qnote.loading', '불러오는 중…') as string}</Dim>
      ) : error ? (
        <Dim>{t('qnote.loadFailed', '회의록을 불러오지 못했습니다.') as string}</Dim>
      ) : shown.length === 0 ? (
        <Empty>
          <EmptyTitle>{t('qnote.empty.title', '이 프로젝트에 연결된 회의록이 없습니다') as string}</EmptyTitle>
          <EmptyDesc>{t('qnote.empty.body', 'Q note 에서 회의록을 만들 때 이 프로젝트를 고르면 여기에 모입니다. 개인 노트는 본인에게만 보이므로 여기 나오지 않습니다.') as string}</EmptyDesc>
        </Empty>
      ) : (
        <List>
          {shown.map((n) => (
            <Row key={n.id} type="button" data-testid={`project-note-row-${n.id}`}
              onClick={() => tabStore.openInNewTab(`/notes/${n.id}`)}>
              <RowBody>
                <Title><HighlightText text={n.title || (t('qnote.untitled', '제목 없음') as string)} query={search} /></Title>
                <Meta>
                  <Tag>{t(`qnote.mode.${n.capture_mode}`, n.capture_mode) as string}</Tag>
                  <span>{formatDateTime(n.created_at)}</span>
                </Meta>
              </RowBody>
              <OutIcon aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h6v6" /><path d="M10 14L21 3" /><path d="M21 14v7H3V3h7" />
              </OutIcon>
            </Row>
          ))}
        </List>
      )}
    </Wrap>
  );
}

const Wrap = styled.div`display: flex; flex-direction: column; gap: 10px; padding: 14px 16px;`;
const Toolbar = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const Spacer = styled.div`flex: 1; min-width: 8px;`;
const List = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Row = styled.button`
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
  padding: 12px 14px; background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
  cursor: pointer; font-family: inherit;
  &:hover { background: #F8FAFC; border-color: #CBD5E1; }
`;
const RowBody = styled.div`flex: 1; min-width: 0;`;
const Title = styled.div`font-size: 0.875rem; font-weight: 600; color: #0F172A; word-break: break-word;`;
const Meta = styled.div`margin-top: 4px; display: flex; align-items: center; gap: 8px; font-size: 0.75rem; color: #94A3B8;`;
const Tag = styled.span`padding: 2px 8px; border-radius: 999px; background: #F1F5F9; color: #475569; font-weight: 600;`;
const OutIcon = styled.svg`width: 16px; height: 16px; color: #94A3B8; flex-shrink: 0;`;
const Dim = styled.div`padding: 40px 0; text-align: center; color: #94A3B8; font-size: 0.8125rem;`;
const Empty = styled.div`padding: 48px 20px; text-align: center;`;
const EmptyTitle = styled.div`font-size: 0.9375rem; font-weight: 700; color: #334155;`;
const EmptyDesc = styled.div`margin-top: 8px; font-size: 0.8125rem; color: #94A3B8; line-height: 1.6;`;
