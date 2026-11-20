// 공개 회사 페이지 «이 페이지 신고» (P3 · 2026-11-20 · docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §6.4)
//   사유 고르기 + 한 줄(선택) + 답 받을 이메일(선택) → PlanQ 운영팀(contact_inquiries kind='report'). 회사에는 가지 않는다.
import { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../../components/Common/StandardModal';

const REASONS = ['spam', 'fake', 'inappropriate', 'other'] as const;

export default function PublicWorkspaceReport({ open, onClose, slug, lang }: { open: boolean; onClose: () => void; slug: string; lang: string }) {
  const { t } = useTranslation('wspage');
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async () => {
    if (!reason || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/public/workspaces/${encodeURIComponent(slug)}/report`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, note, email, locale: lang }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(j?.message || `error_${r.status}`); return; }
      setDone(true);
    } catch { setErr('network'); } finally { setBusy(false); }
  };
  const close = () => { onClose(); setTimeout(() => { setDone(false); setReason(''); setNote(''); setEmail(''); setErr(null); }, 200); };

  return (
    <StandardModal open={open} onClose={close} size="sm" title={t('report.title', '이 페이지 신고') as string}
      footer={done ? <Btn type="button" onClick={close}>{t('report.close', '닫기')}</Btn> : (
        <>
          <Btn type="button" onClick={close}>{t('report.cancel', '취소')}</Btn>
          <Btn type="button" $primary disabled={!reason || busy} onClick={send} data-testid="wspage-report-send">{t('report.send', '신고 보내기')}</Btn>
        </>
      )}>
      {done ? <Muted data-testid="wspage-report-done">{t('report.done', '신고를 받았어요. PlanQ 가 확인할게요.')}</Muted> : (
        <Body>
          <Muted>{t('report.desc', '신고는 PlanQ 운영팀에 전달되고, 이 회사에는 알려지지 않아요.')}</Muted>
          {REASONS.map((r) => (
            <Opt key={r}>
              <input type="radio" name="wsrep" value={r} checked={reason === r} onChange={() => setReason(r)} />
              {t(`report.reason.${r}`)}
            </Opt>
          ))}
          {/* draft-exempt: 무로그인 신고 한 줄(300자) — 초안 키 축이 없고 보내면 끝나는 창 */}
          <Area rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={t('report.notePh', '무엇이 문제인지 한 줄(선택)') as string} />
          <In type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder={t('report.emailPh', '답을 받을 이메일(선택)') as string} />
          {err && <Err role="alert">{t(`report.err.${err}`, t('report.err.generic', '보내지 못했어요. 잠시 뒤 다시 시도해 주세요.'))}</Err>}
        </Body>
      )}
    </StandardModal>
  );
}

const Body = styled.div`display:flex;flex-direction:column;gap:8px;`;
const Muted = styled.div`font-size:0.8125rem;color:#64748B;line-height:1.5;`;
const Opt = styled.label`display:flex;align-items:center;gap:8px;font-size:0.875rem;color:#334155;cursor:pointer;input{accent-color:#14B8A6;}`;
const Area = styled.textarea`padding:8px 10px;border:1px solid #CBD5E1;border-radius:8px;font-size:0.8125rem;font-family:inherit;resize:vertical;`;
const In = styled.input`height:40px;padding:0 10px;border:1px solid #CBD5E1;border-radius:8px;font-size:0.8125rem;`;
const Err = styled.div`font-size:0.75rem;color:#B91C3C;`;
const Btn = styled.button<{ $primary?: boolean }>`height:36px;padding:0 14px;border-radius:8px;cursor:pointer;font-size:0.8125rem;font-weight:600;
  border:1px solid ${(p) => (p.$primary ? '#14B8A6' : '#cbd5e1')};background:${(p) => (p.$primary ? '#14B8A6' : '#fff')};color:${(p) => (p.$primary ? '#fff' : '#334155')};
  &:disabled{opacity:.55;cursor:default;}`;
