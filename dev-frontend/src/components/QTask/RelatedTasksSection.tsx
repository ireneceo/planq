// RelatedTasksSection — 업무 상세에서 다른 업무를 검색·연결하는 섹션
//
// 위치: TaskDetailDrawer 의 description 섹션 바로 아래 (사이클 N+6)
// 양방향 단일 link_type='related'. 같은 워크스페이스 내 task 만 연결 가능.
// chip 클릭 시 URL ?task=:id 로 그 업무 drawer 열림 (기존 URL 싱크 규칙).
// closed task (completed/canceled) 도 연결·표시 (회색 톤, 역사 추적).
// 책임선: workspace 멤버 누구나 연결·해제. 관련 업무는 양쪽 모두 봐야 할 컨텍스트.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';

interface LinkedTask {
  id: number;
  title: string;
  status: string;
  project_id: number | null;
  due_date: string | null;
  assignee_id: number | null;
  Project?: { id: number; name: string } | null;
}

interface LinkRow {
  link_id: number;
  link_type: string;
  created_at: string;
  task: LinkedTask;
}

interface Props {
  taskId: number;
  businessId: number;
  canEdit: boolean;  // workspace 멤버면 true
}

const RelatedTasksSection: React.FC<Props> = ({ taskId, businessId, canEdit }) => {
  const { t } = useTranslation('qtask');
  const [, setSearchParams] = useSearchParams();
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [results, setResults] = useState<LinkedTask[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const searchRef = useRef<number | null>(null);

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/tasks/${taskId}/links`);
      if (r.ok) {
        const j = await r.json();
        if (j.success) setLinks(j.data || []);
      }
    } finally { setLoading(false); }
  }, [taskId]);

  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  // 검색 debounce 250ms
  useEffect(() => {
    if (!adding) return;
    if (searchRef.current) window.clearTimeout(searchRef.current);
    if (!searchQ.trim()) { setResults([]); return; }
    searchRef.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const excludeIds = [taskId, ...links.map(l => l.task.id)].join(',');
        const r = await apiFetch(`/api/tasks/by-business/${businessId}/search?q=${encodeURIComponent(searchQ.trim())}&exclude_ids=${excludeIds}&limit=20`);
        if (r.ok) {
          const j = await r.json();
          if (j.success) setResults(j.data || []);
        }
      } finally { setSearching(false); }
    }, 250);
    return () => { if (searchRef.current) window.clearTimeout(searchRef.current); };
  }, [searchQ, adding, taskId, businessId, links]);

  const link = async (target: LinkedTask) => {
    if (submitting) return;
    setSubmitting(true); setErrMsg(null);
    try {
      const r = await apiFetch(`/api/tasks/${taskId}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_task_id: target.id }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.success) {
        setSearchQ(''); setResults([]); setAdding(false);
        fetchLinks();
      } else {
        const code = j?.message || j?.code || 'link_failed';
        if (code === 'already_linked') setErrMsg(t('links.error.alreadyLinked', { defaultValue: '이미 연결된 업무' }) as string);
        else if (code === 'cannot_link_self') setErrMsg(t('links.error.cannotLinkSelf', { defaultValue: '자기 자신은 연결할 수 없습니다' }) as string);
        else if (code === 'cross_workspace_link_forbidden') setErrMsg(t('links.error.crossWorkspace', { defaultValue: '다른 워크스페이스 업무는 연결할 수 없습니다' }) as string);
        else setErrMsg(t('links.error.failed', { defaultValue: '연결 실패' }) as string);
      }
    } finally { setSubmitting(false); }
  };

  const unlink = async (targetId: number) => {
    try {
      const r = await apiFetch(`/api/tasks/${taskId}/links/${targetId}`, { method: 'DELETE' });
      if (r.ok) fetchLinks();
    } catch { /* silent */ }
  };

  const openTask = (id: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('task', String(id));
      return next;
    }, { replace: false });
  };

  return (
    <Wrap>
      <Title>
        {t('links.title', { defaultValue: '관련 업무' })}
        {links.length > 0 && <Count>{links.length}</Count>}
      </Title>

      {loading ? (
        <Empty>{t('links.loading', { defaultValue: '불러오는 중...' })}</Empty>
      ) : links.length === 0 && !adding ? (
        <Empty>{t('links.empty', { defaultValue: '연결된 업무 없음' })}</Empty>
      ) : (
        <ChipList>
          {links.map((l) => {
            const isClosed = l.task.status === 'completed' || l.task.status === 'canceled';
            return (
              <Chip key={l.link_id} type="button" onClick={() => openTask(l.task.id)} $closed={isClosed} title={l.task.title}>
                <ChipIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                </ChipIcon>
                <ChipText>
                  <ChipTitle>{l.task.title}</ChipTitle>
                  {l.task.Project?.name && <ChipMeta>{l.task.Project.name}</ChipMeta>}
                </ChipText>
                {canEdit && (
                  <ChipRemove role="button" onClick={(e) => { e.stopPropagation(); unlink(l.task.id); }}
                    title={t('links.remove', { defaultValue: '연결 해제' }) as string}
                    aria-label={t('links.remove', { defaultValue: '연결 해제' }) as string}>
                    ×
                  </ChipRemove>
                )}
              </Chip>
            );
          })}
        </ChipList>
      )}

      {canEdit && (
        adding ? (
          <Picker>
            <PickerInput
              autoFocus value={searchQ}
              onChange={(e) => { setSearchQ(e.target.value); setErrMsg(null); }}
              placeholder={t('links.searchPlaceholder', { defaultValue: '업무 제목 검색...' }) as string}
              onKeyDown={(e) => { if (e.key === 'Escape') { setAdding(false); setSearchQ(''); setResults([]); setErrMsg(null); } }}
            />
            <PickerCancel type="button" onClick={() => { setAdding(false); setSearchQ(''); setResults([]); setErrMsg(null); }}>
              {t('common.cancel', '취소')}
            </PickerCancel>
            {errMsg && <ErrLine>{errMsg}</ErrLine>}
            {searching && <Empty>{t('links.searching', { defaultValue: '검색 중...' })}</Empty>}
            {!searching && searchQ.trim() && results.length === 0 && (
              <Empty>{t('links.searchEmpty', { defaultValue: '검색 결과 없음' })}</Empty>
            )}
            {results.length > 0 && (
              <ResultsList>
                {results.map((r) => {
                  const isClosed = r.status === 'completed' || r.status === 'canceled';
                  return (
                    <ResultItem key={r.id} type="button" onClick={() => link(r)} disabled={submitting} $closed={isClosed}>
                      <ResultTitle>{r.title}</ResultTitle>
                      {r.Project?.name && <ResultMeta>{r.Project.name}</ResultMeta>}
                    </ResultItem>
                  );
                })}
              </ResultsList>
            )}
          </Picker>
        ) : (
          <AddBtn type="button" onClick={() => setAdding(true)}>
            <AddIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></AddIcon>
            {t('links.add', { defaultValue: '연결하기' })}
          </AddBtn>
        )
      )}
    </Wrap>
  );
};

export default RelatedTasksSection;

// ─── Styled ───
const Wrap = styled.div`margin-top:16px;`;
const Title = styled.h4`display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:13px;font-weight:600;color:#475569;`;
const Count = styled.span`display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;padding:0 6px;border-radius:8px;background:#F1F5F9;color:#475569;font-size:11px;font-weight:700;`;
const Empty = styled.div`padding:8px 0;font-size:12px;color:#94A3B8;`;
const ChipList = styled.div`display:flex;flex-wrap:wrap;gap:6px;`;
const Chip = styled.button<{$closed?: boolean}>`
  display:inline-flex;align-items:center;gap:6px;padding:6px 6px 6px 10px;
  background:${p => p.$closed ? '#F8FAFC' : '#F0FDFA'};
  color:${p => p.$closed ? '#94A3B8' : '#0F766E'};
  border:1px solid ${p => p.$closed ? '#E2E8F0' : '#CCFBF1'};
  border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;
  max-width:280px;transition:background 0.15s, border-color 0.15s;
  &:hover{background:${p => p.$closed ? '#F1F5F9' : '#CCFBF1'};border-color:${p => p.$closed ? '#CBD5E1' : '#5EEAD4'};}
`;
const ChipIcon = styled.svg`width:12px;height:12px;flex-shrink:0;`;
const ChipText = styled.span`display:inline-flex;align-items:center;gap:6px;min-width:0;`;
const ChipTitle = styled.span`overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;`;
const ChipMeta = styled.span`color:#94A3B8;font-size:11px;font-weight:400;flex-shrink:0;`;
const ChipRemove = styled.span`
  display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;border-radius:4px;color:#94A3B8;font-size:14px;line-height:1;cursor:pointer;
  &:hover{background:#FEE2E2;color:#DC2626;}
`;
const AddBtn = styled.button`
  display:inline-flex;align-items:center;gap:4px;margin-top:8px;
  padding:6px 12px;background:transparent;color:#0F766E;
  border:1px dashed #CBD5E1;border-radius:8px;
  font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;
  transition:background 0.15s, border-color 0.15s;
  &:hover{background:#F0FDFA;border-color:#14B8A6;border-style:solid;}
`;
const AddIcon = styled.svg`width:12px;height:12px;`;
const Picker = styled.div`
  margin-top:8px;padding:10px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;
`;
const PickerInput = styled.input`
  width:calc(100% - 70px);padding:6px 10px;height:32px;border:1px solid #CBD5E1;
  border-radius:6px;font-size:13px;color:#0F172A;background:#FFFFFF;font-family:inherit;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}
`;
const PickerCancel = styled.button`
  margin-left:6px;padding:6px 10px;height:32px;border:1px solid #E2E8F0;background:#FFFFFF;
  border-radius:6px;font-size:12px;font-weight:500;color:#64748B;cursor:pointer;font-family:inherit;
  &:hover{background:#F1F5F9;}
`;
const ErrLine = styled.div`margin-top:6px;font-size:12px;color:#DC2626;`;
const ResultsList = styled.div`margin-top:8px;display:flex;flex-direction:column;gap:2px;max-height:240px;overflow-y:auto;`;
const ResultItem = styled.button<{$closed?: boolean}>`
  display:flex;align-items:center;gap:8px;padding:8px 10px;
  background:#FFFFFF;border:1px solid #E2E8F0;border-radius:6px;
  cursor:pointer;text-align:left;font-family:inherit;
  opacity:${p => p.$closed ? 0.55 : 1};transition:background 0.15s, border-color 0.15s;
  &:hover:not(:disabled){background:#F0FDFA;border-color:#14B8A6;}
  &:disabled{cursor:not-allowed;opacity:0.5;}
`;
const ResultTitle = styled.span`flex:1;font-size:13px;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const ResultMeta = styled.span`font-size:11px;color:#94A3B8;flex-shrink:0;`;
