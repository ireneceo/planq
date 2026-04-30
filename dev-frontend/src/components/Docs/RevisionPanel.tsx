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

// 두 문자열의 공통 prefix/suffix 길이를 찾아 변경된 중간 부분만 강조.
// 예: "워프로랩" → "워프로랩 주식회사" 시 prefix=4, suffix=0 → added=" 주식회사"
const splitInlineDiff = (a: string, b: string) => {
  const minLen = Math.min(a.length, b.length);
  let pre = 0;
  while (pre < minLen && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (
    suf < minLen - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  ) suf++;
  return {
    prefix: a.slice(0, pre),
    removed: a.slice(pre, a.length - suf),
    added: b.slice(pre, b.length - suf),
    suffix: suf > 0 ? a.slice(a.length - suf) : '',
  };
};

// body_json (TipTap doc) → 텍스트 길이 추정 (문자 수 변화 표기용)
const bodyTextLength = (v: unknown): number => {
  if (v == null) return 0;
  if (typeof v === 'string') return v.length;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).length;
  try {
    return JSON.stringify(v).replace(/[{}[\]"',:]/g, '').length;
  } catch { return 0; }
};

// 카운트 표기용 — form_data 안의 실제 변경 sub-key 수까지 풀어서 셈
const countActualChanges = (fields: Record<string, { from: unknown; to: unknown }>): number => {
  let n = 0;
  for (const [k, c] of Object.entries(fields)) {
    if (k === 'form_data') {
      const fromObj = (c.from && typeof c.from === 'object' ? c.from : {}) as Record<string, unknown>;
      const toObj = (c.to && typeof c.to === 'object' ? c.to : {}) as Record<string, unknown>;
      const allKeys = new Set([...Object.keys(fromObj), ...Object.keys(toObj)]);
      for (const sk of allKeys) {
        if (JSON.stringify(fromObj[sk]) !== JSON.stringify(toObj[sk])) n++;
      }
    } else {
      n++;
    }
  }
  return n;
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

  // form_data 는 백엔드가 객체 전체를 단일 diff 로 기록 (changed_fields.form_data = {from: 전체, to: 전체})
  // → 사용자에게는 슬롯별로 풀어서 보여줘야 의미 있음. 두 객체의 합집합 key 를 비교해 변경된 sub-key 만 노출.
  const renderFormDataChange = (change: { from: unknown; to: unknown }): React.ReactNode[] => {
    const fromObj = (change.from && typeof change.from === 'object' ? change.from : {}) as Record<string, unknown>;
    const toObj = (change.to && typeof change.to === 'object' ? change.to : {}) as Record<string, unknown>;
    const allKeys = Array.from(new Set([...Object.keys(fromObj), ...Object.keys(toObj)]));
    const rows: React.ReactNode[] = [];
    for (const k of allKeys) {
      const a = fromObj[k];
      const b = toObj[k];
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      rows.push(renderChange(k, { from: a, to: b }));
    }
    return rows;
  };

  const renderChange = (key: string, change: { from: unknown; to: unknown }): React.ReactNode => {
    if (key === 'form_data') {
      const rows = renderFormDataChange(change);
      if (rows.length === 0) return null;
      return <React.Fragment key={key}>{rows}</React.Fragment>;
    }
    const label = slotLabels?.[key] || key;
    const isBody = BODY_KEYS.has(key);
    if (isBody) {
      const fromLen = bodyTextLength(change.from);
      const toLen = bodyTextLength(change.to);
      const delta = toLen - fromLen;
      return (
        <ChangeRow key={key}>
          <FieldLabel>{label}</FieldLabel>
          <BodyChangeRow>
            <BodyChange>{t('revision.bodyEdited', '본문 수정됨')}</BodyChange>
            {delta !== 0 && (
              <DeltaPill $kind={delta > 0 ? 'added' : 'removed'}>
                {delta > 0 ? '+' : ''}{delta}
              </DeltaPill>
            )}
          </BodyChangeRow>
        </ChangeRow>
      );
    }

    // string ↔ string 인 경우 — 공통 prefix/suffix 검출해 변경 부분만 인라인 강조
    const fromStr = typeof change.from === 'string' ? change.from : null;
    const toStr = typeof change.to === 'string' ? change.to : null;
    if (fromStr !== null && toStr !== null && (fromStr || toStr)) {
      const d = splitInlineDiff(fromStr, toStr);
      const isPureAdd = d.removed === '' && d.added !== '';
      const isPureRemove = d.added === '' && d.removed !== '';
      const isReplace = d.removed !== '' && d.added !== '';
      // 공통 부분이 충분할 때만 inline 표시 (그 외 통째 from→to)
      const commonRatio = (d.prefix.length + d.suffix.length) /
        Math.max(1, Math.max(fromStr.length, toStr.length));
      if (commonRatio >= 0.3 && (isPureAdd || isPureRemove || isReplace)) {
        return (
          <ChangeRow key={key}>
            <FieldLabel>{label}</FieldLabel>
            <InlineDiffBox>
              {d.prefix && <InlineCommon>{d.prefix}</InlineCommon>}
              {d.removed && <InlineRemoved>{d.removed}</InlineRemoved>}
              {d.added && <InlineAdded>{d.added}</InlineAdded>}
              {d.suffix && <InlineCommon>{d.suffix}</InlineCommon>}
            </InlineDiffBox>
          </ChangeRow>
        );
      }
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
                <FieldCount>{t('revision.fieldsCount', '{{n}}건', { n: countActualChanges(fields) })}</FieldCount>
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
const BodyChangeRow = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const DeltaPill = styled.span<{ $kind: 'added' | 'removed' }>`
  display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  ${p => p.$kind === 'added'
    ? 'background:#DCFCE7;color:#166534;border:1px solid #BBF7D0;'
    : 'background:#FEF2F2;color:#B91C1C;border:1px solid #FECACA;'}
`;
const InlineDiffBox = styled.div`
  display: inline-flex; flex-wrap: wrap; align-items: baseline;
  font-size: 12px; line-height: 1.6;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
  padding: 4px 8px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 6px;
`;
const InlineCommon = styled.span`color: #334155;`;
const InlineRemoved = styled.span`
  color: #B91C1C; background: #FEE2E2; text-decoration: line-through;
  padding: 0 2px; border-radius: 3px;
`;
const InlineAdded = styled.span`
  color: #166534; background: #DCFCE7;
  padding: 0 2px; border-radius: 3px;
`;
