// 플랫폼 관리자 «공개 페이지 심사» — /admin/public-pages (P3 · 2026-11-20 · docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §6.4)
//
//   Irene 결정 ④ — «회사 찾기» 첫 공개는 PlanQ 승인. 대기·공개·내림·꺼짐 목록 · [승인] [돌려보내기+사유] [내리기+사유] [내림 풀기]
//   · 전체 끄기 스위치(사고 때 모든 공개 주소·디렉터리·공개 문의를 한 번에 404).
// ★ 공개 중인 페이지는 승인 뒤 수정이 바로 반영된다(다시 심사하지 않는다) — 그래서 «최근 고친 순» 으로 본다.
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../../components/Layout/PageShell';
import { SegmentedToggle, SegmentedBtn } from '../../components/Common/segmentedToggle';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import StandardModal from '../../components/Common/StandardModal';
import EntryInfoView from '../Guest/EntryInfoView';
import { apiFetch } from '../../contexts/AuthContext';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import type { EntryInfo } from '../Guest/GuestWorkspacePage';

type Status = 'pending' | 'public' | 'blocked' | 'off';
type Row = { id: number; slug: string; name: string; category: string | null; region: string | null; status: Status;
  published_at: string | null; updated_at: string; block_reason: string | null; plan: string; eligible: boolean; preview: EntryInfo };

export default function AdminPublicPagesPage() {
  const { t } = useTranslation('wspage');
  const { formatDateTime } = useTimeFormat();
  const [sp, setSp] = useSearchParams();
  const status = (['pending', 'public', 'blocked', 'off'].includes(sp.get('status') || '') ? sp.get('status') : 'pending') as Status;
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [switchOn, setSwitchOn] = useState(true);
  const [preview, setPreview] = useState<Row | null>(null);
  const [ask, setAsk] = useState<{ row: Row; action: 'approve' | 'return' | 'block' | 'unblock' } | null>(null);
  const [reason, setReason] = useState('');
  const [askSwitch, setAskSwitch] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/admin/public-pages?status=${status}`);
    const j = await r.json().catch(() => null);
    if (j?.success) { setRows(j.data.items); setCounts(j.data.counts); setSwitchOn(j.data.switch_on); }
  }, [status]);
  useEffect(() => { void load(); }, [load]);
  useVisibilityRefresh(load);

  const run = async () => {
    if (!ask) return;
    setErr(null);
    const r = await apiFetch(`/api/admin/public-pages/${ask.row.id}/${ask.action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) { setErr(j?.message || `error_${r.status}`); return; }
    setAsk(null); setReason(''); void load();
  };
  // autosave-exempt: 확인 창(ConfirmDialog) 뒤에 누르는 동작 버튼 — 전체 끄기·다시 열기는 입력이 아니라 결정이다
  const flipSwitch = async () => {
    const r = await apiFetch('/api/admin/public-pages/switch', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !switchOn }),
    });
    const j = await r.json().catch(() => null);
    if (j?.success) setSwitchOn(j.data.enabled);
    setAskSwitch(false);
  };
  const needReason = ask?.action === 'return' || ask?.action === 'block';

  return (
    <PageShell title={t('admin.title', '공개 페이지 심사')} count={counts[status]}
      actions={(
        <SegmentedToggle role="tablist">
          {(['pending', 'public', 'blocked', 'off'] as Status[]).map((s) => (
            <SegmentedBtn key={s} type="button" role="tab" $active={status === s} data-testid={`admin-pp-tab-${s}`}
              onClick={() => { const n = new URLSearchParams(sp); n.set('status', s); setSp(n, { replace: true }); }}>
              {t(`admin.status.${s}`)} {counts[s] ?? 0}
            </SegmentedBtn>
          ))}
        </SegmentedToggle>
      )}>
      <SwitchRow>
        <span>{switchOn ? t('admin.switchOn', '공개 페이지·회사 찾기가 열려 있어요.') : t('admin.switchOff', '전체 끄기 중 — 모든 공개 주소·회사 찾기·공개 문의가 닫혀 있어요.')}</span>
        <Btn type="button" $danger={switchOn} onClick={() => setAskSwitch(true)} data-testid="admin-pp-switch">
          {switchOn ? t('admin.turnOff', '전체 끄기') : t('admin.turnOn', '다시 열기')}
        </Btn>
      </SwitchRow>
      {rows.length === 0 ? <Muted>{t('admin.empty', '이 칸에는 워크스페이스가 없어요.')}</Muted> : (
        <List>
          {rows.map((r) => (
            <Item key={r.id} data-testid={`admin-pp-row-${r.id}`}>
              <Main>
                <Name>{r.name}</Name>
                <Sub>/w/{r.slug} · {r.category ? t(`category.${r.category}`) : '—'}{r.region ? ` · ${t(`region.${r.region}`)}` : ''} · {r.plan}{!r.eligible ? ` · ${t('admin.ineligible', '노출 자격 없음(무료)')}` : ''}</Sub>
                <Sub>{t('admin.updated', '고친 시각')} {formatDateTime(r.updated_at)}{r.block_reason ? ` · ${t('admin.reason', '사유')}: ${r.block_reason}` : ''}</Sub>
              </Main>
              <Acts>
                <Btn type="button" onClick={() => setPreview(r)}>{t('admin.preview', '내용 보기')}</Btn>
                {r.status === 'public' && <Btn as="a" href={`/w/${r.slug}`} target="_blank" rel="noopener noreferrer">{t('admin.open', '열기')}</Btn>}
                {r.status === 'pending' && <Btn type="button" $primary onClick={() => setAsk({ row: r, action: 'approve' })} data-testid={`admin-pp-approve-${r.id}`}>{t('admin.approve', '승인')}</Btn>}
                {r.status === 'pending' && <Btn type="button" onClick={() => setAsk({ row: r, action: 'return' })} data-testid={`admin-pp-return-${r.id}`}>{t('admin.return', '돌려보내기')}</Btn>}
                {r.status !== 'blocked' && <Btn type="button" $danger onClick={() => setAsk({ row: r, action: 'block' })} data-testid={`admin-pp-block-${r.id}`}>{t('admin.block', '내리기')}</Btn>}
                {r.status === 'blocked' && <Btn type="button" onClick={() => setAsk({ row: r, action: 'unblock' })}>{t('admin.unblock', '내림 풀기')}</Btn>}
              </Acts>
            </Item>
          ))}
        </List>
      )}

      <StandardModal open={!!preview} onClose={() => setPreview(null)} size="lg" title={preview?.name || ''}>
        {preview && <PreviewBody><EntryInfoView entry={preview.preview} bookingOn={false} onAsk={() => {}} onBook={() => {}} preview workspaceName={preview.name} /></PreviewBody>}
      </StandardModal>

      <StandardModal open={!!ask} onClose={() => { setAsk(null); setReason(''); setErr(null); }} size="sm"
        title={ask ? t(`admin.confirm.${ask.action}`, ask.action) as string : ''}
        footer={(
          <>
            <Btn type="button" onClick={() => { setAsk(null); setReason(''); }}>{t('admin.cancel', '취소')}</Btn>
            <Btn type="button" $primary={ask?.action === 'approve' || ask?.action === 'unblock'} $danger={ask?.action === 'block'}
              disabled={needReason && !reason.trim()} onClick={run} data-testid="admin-pp-confirm">{t('admin.ok', '확인')}</Btn>
          </>
        )}>
        {ask && (
          <ConfirmBody>
            <div>{ask.row.name} · /w/{ask.row.slug}</div>
            <Muted>{t(`admin.confirmBody.${ask.action}`)}</Muted>
            {needReason && (
              <>
                {/* draft-exempt: 관리자 사유 한 줄(255자) — 확인 창에서 바로 보내는 짧은 문구 */}
                <Area rows={3} maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder={t('admin.reasonPh', '대표에게 보일 사유') as string} data-testid="admin-pp-reason" />
              </>
            )}
            {err && <Err>{t(`admin.err.${err}`, err)}</Err>}
          </ConfirmBody>
        )}
      </StandardModal>

      <ConfirmDialog
        isOpen={askSwitch}
        title={(switchOn ? t('admin.turnOffTitle', '공개 페이지를 전체 끌까요?') : t('admin.turnOnTitle', '공개 페이지를 다시 열까요?')) as string}
        message={(switchOn ? t('admin.turnOffBody', '모든 /w/ 주소·회사 찾기·공개 문의가 바로 닫힙니다(30초 안). 고객 창구 링크는 그대로입니다.') : t('admin.turnOnBody', '승인된 공개 페이지가 다시 보입니다.')) as string}
        confirmText={t('admin.ok', '확인') as string} cancelText={t('admin.cancel', '취소') as string}
        variant={switchOn ? 'danger' : 'info'} onConfirm={flipSwitch} onClose={() => setAskSwitch(false)} />
    </PageShell>
  );
}

const SwitchRow = styled.div`display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 16px;
  background:#fff;border:1px solid #E2E8F0;border-radius:12px;margin-bottom:12px;font-size:0.8125rem;color:#334155;`;
const List = styled.div`display:flex;flex-direction:column;gap:8px;`;
const Item = styled.div`display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;background:#fff;border:1px solid #E2E8F0;border-radius:12px;`;
const Main = styled.div`flex:1;min-width:220px;display:flex;flex-direction:column;gap:2px;`;
const Name = styled.div`font-size:0.9375rem;font-weight:700;color:#0F172A;`;
const Sub = styled.div`font-size:0.75rem;color:#64748B;`;
const Acts = styled.div`display:flex;gap:6px;flex-wrap:wrap;`;
const Btn = styled.button<{ $primary?: boolean; $danger?: boolean }>`display:inline-flex;align-items:center;height:36px;padding:0 12px;border-radius:8px;cursor:pointer;
  font-size:0.8125rem;font-weight:600;text-decoration:none;
  border:1px solid ${(p) => (p.$primary ? '#14B8A6' : p.$danger ? '#FECDD3' : '#cbd5e1')};
  background:${(p) => (p.$primary ? '#14B8A6' : '#fff')};color:${(p) => (p.$primary ? '#fff' : p.$danger ? '#B91C3C' : '#334155')};
  &:disabled{opacity:.55;cursor:default;}`;
const Muted = styled.div`font-size:0.8125rem;color:#64748B;`;
const PreviewBody = styled.div`display:flex;flex-direction:column;gap:16px;`;
const ConfirmBody = styled.div`display:flex;flex-direction:column;gap:8px;font-size:0.875rem;color:#0F172A;`;
const Area = styled.textarea`padding:8px 10px;border:1px solid #CBD5E1;border-radius:8px;font-family:inherit;font-size:0.8125rem;resize:vertical;`;
const Err = styled.div`font-size:0.75rem;color:#B91C3C;`;
