// 고객 변경 이력(감사 기록) — 누가 언제 초대·보관·수정했는가. 접힘이 기본(열 때 한 번 읽는다).
//   2026-10-16 설정 > 고객 드로어에서 빼서 Q sale 패널·상세 페이지가 같이 쓴다. 통합 히스토리(대화·메일·업무)와는 다른 축이다.
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { Section, SectionTitle, SectionTitleRow, Dim, HistoryToggle } from './clientDetailStyles';

interface HistoryEntry {
  id: number;
  action: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
  User?: { id: number; name: string } | null;
}

function labelFor(action: string, t: TFunction): string {
  switch (action) {
    case 'client.invited': return t('history.invited');
    case 'client.reinvited': return t('history.reinvited');
    case 'client.created_managed': return t('history.createdManaged');
    case 'client.registered_managed': return t('history.registeredManaged');
    case 'client.activated': return t('history.activated');
    case 'client.archived': return t('history.archived');
    case 'client.updated': return t('history.updated');
    case 'client.deleted': return t('history.deleted');
    case 'project.client_added': return t('history.projectAdded');
    case 'project.client_removed': return t('history.projectRemoved');
    default: return action;
  }
}

function detailOf(h: HistoryEntry): string | null {
  if (h.action === 'client.updated' && h.old_value && h.new_value) {
    return Object.keys(h.new_value).map((k) => `${k}: "${String(h.old_value?.[k] ?? '')}" → "${String(h.new_value?.[k] ?? '')}"`).join(', ');
  }
  if (h.action === 'project.client_added' || h.action === 'project.client_removed') {
    const v = (h.new_value || h.old_value) as { project_name?: string } | null;
    return v?.project_name || null;
  }
  return null;
}

export default function ClientAuditHistory({ businessId, clientId }: { businessId: number; clientId: number }) {
  const { t } = useTranslation('clients');
  const { formatDate } = useTimeFormat();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  // 대상이 바뀌면 접고 비운다 — 떠난 고객의 이력이 남아 보이면 안 된다
  useEffect(() => { setOpen(false); setRows(null); setFailed(false); }, [clientId]);
  useEffect(() => {
    if (!open || rows) return;
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch(`/api/clients/${businessId}/${clientId}/history`);
        const j = await r.json().catch(() => null);
        if (!alive) return;
        if (!r.ok || !j?.success) { setFailed(true); return; }
        setRows(j.data || []);
      } catch { if (alive) setFailed(true); }
    })();
    return () => { alive = false; };
  }, [open, rows, businessId, clientId]);

  return (
    <Section data-testid="client-audit-history">
      <SectionTitleRow>
        <SectionTitle>{t('section.history')}</SectionTitle>
        <HistoryToggle type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t('section.historyToggleClose') : t('section.historyToggleOpen')}
        </HistoryToggle>
      </SectionTitleRow>
      {open && (
        failed ? <Dim>{t('section.historyFailed', { defaultValue: '불러오지 못했습니다' }) as string}</Dim>
          : !rows ? <Dim>{t('section.historyLoading')}</Dim>
            : rows.length === 0 ? <Dim>{t('section.historyEmpty')}</Dim>
              : (
                <List>
                  {rows.map((h) => {
                    const d = detailOf(h);
                    return (
                      <Item key={h.id}>
                        <Head><strong>{h.User?.name || '—'}</strong><Ev>{labelFor(h.action, t)}</Ev></Head>
                        {d && <Note>{d}</Note>}
                        <When>{formatDate(h.created_at)}</When>
                      </Item>
                    );
                  })}
                </List>
              )
      )}
    </Section>
  );
}

const List = styled.div`display:flex;flex-direction:column;gap:10px;padding-left:10px;border-left:2px solid #E2E8F0;margin-top:4px;`;
const Item = styled.div`font-size:0.75rem;color:#334155;`;
const Head = styled.div`display:flex;flex-wrap:wrap;align-items:center;gap:6px;`;
const Ev = styled.span`color:#64748B;`;
const Note = styled.div`margin-top:2px;padding:4px 8px;background:#F8FAFC;border-radius:4px;font-size:0.6875rem;color:#475569;word-break:break-all;`;
const When = styled.div`margin-top:2px;font-size:0.625rem;color:#94A3B8;`;
