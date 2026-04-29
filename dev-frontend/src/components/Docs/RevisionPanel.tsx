// 사이클 I4 — 문서 revision 이력 + 슬롯 변경 diff 패널
//
// DocumentEditorPage 의 SideCol 또는 별도 drawer 에 사용.
// 백엔드 GET /api/docs/documents/:id/revisions 가 changed_fields { key: {from, to} } 반환.
// 표시 흐름:
//   - 최신 → 가장 오래된 순 (revision_number DESC)
//   - 한 revision 안에 여러 슬롯 변경 — 슬롯 key 별 from → to
//   - revision 없음 → 빈 상태 (편집 시 자동 기록 안내)
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { listDocumentRevisions, type DocRevision } from '../../services/docs';

interface Props {
  docId: number;
  /** 슬롯 key → label 매핑 (template.schema_json 의 라벨 사용) */
  slotLabels?: Record<string, string>;
  /** revision 추가 후 외부에서 reload 트리거 */
  reloadKey?: number;
}

const fmtValue = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 78) + '…' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 80 ? s.slice(0, 78) + '…' : s;
  } catch { return String(v); }
};

const fmtTime = (iso: string): string => {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch { return iso; }
};

// 본문(body_json) 변경은 너무 거대해 단순 "본문 수정" 표시
const BODY_KEYS = new Set(['body_json', 'body_html', 'content_json']);

const RevisionPanel: React.FC<Props> = ({ docId, slotLabels, reloadKey }) => {
  const { t } = useTranslation('qdocs');
  const [revisions, setRevisions] = useState<DocRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    setLoading(true);
    listDocumentRevisions(docId)
      .then(list => { setRevisions(list); setErr(null); })
      .catch(e => setErr(e.message || 'failed'))
      .finally(() => setLoading(false));
  }, [docId, reloadKey]);

  const toggle = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const renderChange = (key: string, change: { from: unknown; to: unknown }) => {
    const label = slotLabels?.[key] || key;
    const isBody = BODY_KEYS.has(key);
    if (isBody) {
      return (
        <ChangeRow key={key}>
          <FieldLabel>{label}</FieldLabel>
          <BodyChange>{t('revision.bodyEdited', '본문 수정됨')}</BodyChange>
        </ChangeRow>
      );
    }
    return (
      <ChangeRow key={key}>
        <FieldLabel>{label}</FieldLabel>
        <DiffBox>
          <FromVal>{fmtValue(change.from)}</FromVal>
          <Arrow>→</Arrow>
          <ToVal>{fmtValue(change.to)}</ToVal>
        </DiffBox>
      </ChangeRow>
    );
  };

  if (loading) return <Wrap><Hint>{t('revision.loading', '이력 로드 중…')}</Hint></Wrap>;
  if (err) return <Wrap><Err>{err}</Err></Wrap>;
  if (revisions.length === 0) {
    return (
      <Wrap>
        <SectionLabel>{t('revision.title', '변경 이력')}</SectionLabel>
        <EmptyHint>{t('revision.empty', '아직 변경 이력이 없습니다. 슬롯·본문을 편집하면 자동으로 기록됩니다.')}</EmptyHint>
      </Wrap>
    );
  }

  return (
    <Wrap>
      <SectionLabel>
        {t('revision.title', '변경 이력')} <Count>{revisions.length}</Count>
      </SectionLabel>
      <List>
        {revisions.map(r => {
          const open = expanded.has(r.id);
          const fields = r.changed_fields || {};
          const fieldKeys = Object.keys(fields);
          return (
            <Item key={r.id}>
              <ItemHead onClick={() => toggle(r.id)} aria-expanded={open}>
                <RevNum>v{r.revision_number}</RevNum>
                <RevMeta>
                  <Changer>{r.changer?.name || `#${r.changed_by ?? '—'}`}</Changer>
                  <Time>{fmtTime(r.created_at)}</Time>
                </RevMeta>
                <FieldCount>{t('revision.fieldsCount', '{{n}}건', { n: fieldKeys.length })}</FieldCount>
                <Caret $open={open}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </Caret>
              </ItemHead>
              {open && (
                <ItemBody>
                  {fieldKeys.length === 0 ? (
                    <Hint>{t('revision.noChanges', '변경 내용 없음')}</Hint>
                  ) : (
                    fieldKeys.map(k => renderChange(k, fields[k]))
                  )}
                </ItemBody>
              )}
            </Item>
          );
        })}
      </List>
    </Wrap>
  );
};

export default RevisionPanel;

// ─── styled ───
const Wrap = styled.div`
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;
const SectionLabel = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A;
  display: flex; align-items: center; gap: 8px;
`;
const Count = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 18px; padding: 0 6px;
  background: #F0FDFA; color: #0F766E;
  font-size: 11px; font-weight: 700;
  border-radius: 999px;
`;
const Hint = styled.div`font-size: 12px; color: #94A3B8; padding: 8px 0;`;
const EmptyHint = styled.div`font-size: 12px; color: #94A3B8; padding: 4px 0; line-height: 1.55;`;
const Err = styled.div`font-size: 12px; color: #DC2626; padding: 8px 12px; background: #FEF2F2; border-radius: 6px;`;
const List = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Item = styled.div`
  border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden;
  background: #FFFFFF;
`;
const ItemHead = styled.button`
  all: unset;
  cursor: pointer;
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 10px; align-items: center;
  width: 100%; padding: 8px 12px;
  &:hover { background: #F8FAFC; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: -2px; }
`;
const RevNum = styled.div`
  font-size: 11px; font-weight: 700; color: #0F766E;
  background: #F0FDFA; padding: 2px 8px; border-radius: 999px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
`;
const RevMeta = styled.div`display: flex; flex-direction: column; gap: 2px; min-width: 0;`;
const Changer = styled.span`
  font-size: 12px; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const Time = styled.span`font-size: 11px; color: #64748B;`;
const FieldCount = styled.span`
  font-size: 11px; font-weight: 600; color: #475569;
  background: #F1F5F9; padding: 2px 8px; border-radius: 999px;
  flex-shrink: 0;
`;
const Caret = styled.span<{ $open: boolean }>`
  color: #94A3B8; transition: transform 0.15s;
  transform: rotate(${p => p.$open ? '180deg' : '0deg'});
  display: inline-flex;
`;
const ItemBody = styled.div`
  padding: 8px 12px 12px;
  border-top: 1px solid #F1F5F9;
  display: flex; flex-direction: column; gap: 8px;
`;
const ChangeRow = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const FieldLabel = styled.div`
  font-size: 11px; font-weight: 600; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const DiffBox = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 12px;
`;
const FromVal = styled.span`
  padding: 2px 8px; border-radius: 4px;
  background: #FEF2F2; color: #B91C1C;
  text-decoration: line-through;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
`;
const ToVal = styled.span`
  padding: 2px 8px; border-radius: 4px;
  background: #DCFCE7; color: #166534;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
`;
const Arrow = styled.span`color: #94A3B8; font-size: 12px;`;
const BodyChange = styled.span`
  font-size: 12px; color: #475569; font-style: italic;
`;
