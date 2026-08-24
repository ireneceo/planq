// 외부 API 선불 크레딧 현황 — Deepgram(Q Note 음성인식) · OpenAI(AI 기능 전반)
//
// Irene 2026-08-24: "0이 되기 전에 결제하게 해줘야지."
//   그래서 이 카드의 주인공은 잔액이 아니라 **남은 일수**다. 같은 20% 라도 하루 만에 마를 수도,
//   반년 갈 수도 있다. 최근 소비 속도로 나눈 "이 속도면 N일" 이 있어야 충전할지 판단이 된다.
//
// 잔액은 제공사 API 로 못 읽는다(권한·엔드포인트 불안정) → 콘솔에서 본 값을 기준선으로 넣으면
//   서버가 우리 원장 소비를 빼서 추정한다. **충전할 때마다 새 잔액을 다시 넣는 것이 정상 운용** —
//   그래야 누적 오차가 리셋된다.
import { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';

interface ProviderStatus {
  provider: string;
  label: string;
  configured: boolean;
  balance_start_usd: number | null;
  balance_start_at: string | null;
  spent_usd: number | null;
  remaining_usd: number | null;
  daily_rate_usd: number | null;
  days_left: number | null;
  topup_url: string | null;
  block_on_empty: boolean;
  blocked: boolean;
}

// 남은 일수 → 색 톤. 경보 단계(서버 ALERT_DAYS)와 같은 눈금을 쓴다.
const toneOf = (s: ProviderStatus): 'ok' | 'warn' | 'danger' => {
  if (s.remaining_usd != null && s.remaining_usd <= 0) return 'danger';
  if (s.days_left == null) return 'ok';
  if (s.days_left <= 7) return 'danger';
  if (s.days_left <= 30) return 'warn';
  return 'ok';
};

const usd = (v: number | null) => (v == null ? '—' : `$${Number(v).toFixed(2)}`);

const ProviderCreditCard = () => {
  const { t } = useTranslation('admin');
  const [rows, setRows] = useState<ProviderStatus[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/admin/provider-credits');
      if (!r.ok) throw new Error('load_failed');
      const j = await r.json();
      setRows(j.data?.providers || []);
    } catch {
      setErr(t('credit.loadFailed', '크레딧 현황을 불러오지 못했습니다.') as string);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const save = async (provider: string) => {
    const raw = (draft[provider] ?? '').trim();
    const val = Number(raw);
    if (!raw || !Number.isFinite(val) || val < 0) {
      setErr(t('credit.invalidBalance', '잔액을 숫자로 입력해 주세요.') as string);
      return;
    }
    setSaving(provider); setErr(null);
    try {
      const r = await apiFetch(`/api/admin/provider-credits/${provider}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance_start_usd: val }),
      });
      // apiFetch 는 throw 하지 않는다 — res.ok 를 안 보면 실패가 성공한 척한다.
      if (!r.ok) throw new Error('save_failed');
      setDraft(p => ({ ...p, [provider]: '' }));
      await load();
    } catch {
      setErr(t('credit.saveFailed', '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') as string);
    } finally {
      setSaving(null);
    }
  };

  if (!rows) return null;

  return (
    <Wrap>
      <SectionTitle>{t('credit.section', '외부 API 크레딧')}</SectionTitle>
      <Desc>
        {t('credit.desc', '소진되면 해당 기능이 중단됩니다. 남은 일수가 줄면 플랫폼 관리자에게 메일로 알립니다(30·14·7·3·1일).')}
      </Desc>
      {err && <ErrBox>{err}</ErrBox>}

      {rows.map((s) => {
        const tone = toneOf(s);
        return (
          <Row key={s.provider} $tone={tone}>
            <Head>
              <Name>{s.label}</Name>
              {s.configured ? (
                <Days $tone={tone}>
                  {s.remaining_usd != null && s.remaining_usd <= 0
                    ? t('credit.exhausted', '소진됨')
                    : s.days_left == null
                      ? t('credit.noBurn', '사용 없음')
                      : t('credit.daysLeft', '{{d}}일 남음', { d: Math.floor(s.days_left) })}
                </Days>
              ) : (
                <Days $tone="warn">{t('credit.notSet', '미설정')}</Days>
              )}
            </Head>

            {s.configured && (
              <Stats>
                <Stat><K>{t('credit.remaining', '예상 잔액')}</K><V>{usd(s.remaining_usd)}</V></Stat>
                <Stat><K>{t('credit.spent', '기준 이후 사용')}</K><V>{usd(s.spent_usd)}</V></Stat>
                <Stat><K>{t('credit.perDay', '하루 평균')}</K><V>{usd(s.daily_rate_usd)}</V></Stat>
                <Stat>
                  <K>{t('credit.baseAt', '기준 시점')}</K>
                  <V>{s.balance_start_at ? String(s.balance_start_at).slice(0, 10) : '—'}</V>
                </Stat>
              </Stats>
            )}

            <Form>
              <Input
                type="number" step="0.01" min="0"
                placeholder={t('credit.placeholder', '콘솔에서 본 잔액 (USD)') as string}
                value={draft[s.provider] ?? ''}
                onChange={(e) => setDraft(p => ({ ...p, [s.provider]: e.target.value }))}
                aria-label={`${s.label} ${t('credit.placeholder', '콘솔에서 본 잔액 (USD)')}`}
              />
              <SaveBtn type="button" disabled={saving === s.provider} onClick={() => save(s.provider)}>
                {saving === s.provider ? t('credit.saving', '저장 중…') : t('credit.save', '기준 잔액 갱신')}
              </SaveBtn>
              {s.topup_url && (
                <TopupLink href={s.topup_url} target="_blank" rel="noopener noreferrer">
                  {t('credit.topup', '충전하러 가기')} ↗
                </TopupLink>
              )}
            </Form>
            <Hint>{t('credit.hint', '충전한 뒤 새 잔액을 다시 입력해야 추정이 정확해집니다.')}</Hint>
          </Row>
        );
      })}
    </Wrap>
  );
};

export default ProviderCreditCard;

// ─── styled ───
const TONE = {
  ok: { bd: '#E2E8F0', fg: '#0F766E', bg: '#F0FDFA' },
  warn: { bd: '#FDE68A', fg: '#D97706', bg: '#FFFBEB' },
  danger: { bd: '#FECACA', fg: '#DC2626', bg: '#FEF2F2' },
} as const;

const Wrap = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 20px; display: flex; flex-direction: column; gap: 12px;
`;
const SectionTitle = styled.h2`font-size: 15px; font-weight: 700; color: #0F172A; margin: 0;`;
const Desc = styled.p`font-size: 12px; color: #64748B; line-height: 1.6; margin: 0; word-break: keep-all;`;
const ErrBox = styled.div`font-size: 12px; color: #DC2626; background: #FEF2F2; padding: 8px 10px; border-radius: 6px;`;
const Row = styled.div<{ $tone: keyof typeof TONE }>`
  border: 1px solid ${p => TONE[p.$tone].bd}; background: ${p => TONE[p.$tone].bg};
  border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px;
`;
const Head = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 12px;`;
const Name = styled.div`font-size: 14px; font-weight: 700; color: #0F172A;`;
const Days = styled.div<{ $tone: keyof typeof TONE }>`
  font-size: 13px; font-weight: 700; color: ${p => TONE[p.$tone].fg}; white-space: nowrap;
`;
const Stats = styled.div`
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
  @media (max-width: 720px) { grid-template-columns: repeat(2, 1fr); }
`;
const Stat = styled.div`display: flex; flex-direction: column; gap: 2px;`;
const K = styled.div`font-size: 11px; color: #94A3B8;`;
const V = styled.div`font-size: 13px; font-weight: 600; color: #0F172A;`;
const Form = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const Input = styled.input`
  flex: 1; min-width: 160px; height: 36px; padding: 0 10px;
  border: 1px solid #CBD5E1; border-radius: 8px; font-size: 13px; background: #FFFFFF;
  &:focus { outline: 2px solid rgba(15,118,110,0.4); outline-offset: -1px; }
`;
const SaveBtn = styled.button`
  height: 36px; padding: 0 14px; border: none; border-radius: 8px;
  background: #0F766E; color: #FFFFFF; font-size: 13px; font-weight: 600; cursor: pointer;
  &:disabled { opacity: 0.6; cursor: default; }
  &:hover:not(:disabled) { background: #115E59; }
`;
const TopupLink = styled.a`
  height: 36px; display: inline-flex; align-items: center; padding: 0 12px;
  border: 1px solid #99F6E4; border-radius: 8px; background: #FFFFFF;
  font-size: 13px; font-weight: 600; color: #0F766E; text-decoration: none;
  &:hover { background: #F0FDFA; }
`;
const Hint = styled.div`font-size: 11px; color: #94A3B8;`;
