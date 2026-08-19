// 도메인 인증 (발신 신뢰도) — SPF / DKIM / DMARC 진단.
//
// 왜 화면에 두는가: "DKIM 됐나요?" 를 사람이 물으면 답하는 쪽이 추측한다. 실제로 그 추측이 두 번
//   틀렸다(와일드카드 DNS 때문에 "DKIM 없음" 오판 · 실재하는 selector 를 못 찾음).
//   여기서 **직접 조회한 레코드 원문**을 보여준다 — 기억이 아니라 DNS 가 근거가 된다.
//
// ★ "우리 도메인"(수신 축)과 다른 축이다. 저기는 "우리에게 온 메일"을 가르는 규칙이고,
//   여기는 "우리가 보낸 메일을 상대 서버가 믿어주는가" 다. 그래서 섹션을 나눠 둔다.
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ActionButton from '../../components/Common/ActionButton';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { apiFetch } from '../../contexts/AuthContext';

type CheckStatus = 'ok' | 'missing' | 'unknown' | 'conflict' | 'lookup_failed';
interface Check { key: string; status: CheckStatus; records: string[]; selector?: string; reason?: string; tried?: string[] }
interface Diagnosis {
  domain: string;
  wildcard_dns: boolean;
  overall: CheckStatus;
  checks: { spf: Check; dmarc: Check; dkim: Check };
}

interface Props { businessId: number }

export default function MailAuthDiagSection({ businessId }: Props) {
  const { t } = useTranslation('qmail');
  const [domains, setDomains] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [selector, setSelector] = useState('');
  const [result, setResult] = useState<Diagnosis | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const base = `/api/businesses/${businessId}`;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch(`${base}/email-auth-domains`);
        if (!r.ok) return;
        const j = await r.json();
        if (!alive || !j.success) return;
        // 목록 라우트 표준 — data 는 배열, pagination 키가 따로 온다
        const list: string[] = Array.isArray(j.data) ? j.data : (j.data?.domains || []);
        setDomains(list);
        setSelected((prev) => prev || list[0] || '');
      } catch { /* 진단은 부가 기능 — 실패해도 설정 화면은 그대로 */ }
    })();
    return () => { alive = false; };
  }, [base]);

  const run = useCallback(async () => {
    if (!selected || busy) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const qs = new URLSearchParams({ domain: selected });
      if (selector.trim()) qs.set('selector', selector.trim());
      const r = await apiFetch(`${base}/email-auth-diagnosis?${qs.toString()}`);
      const j = await r.json().catch(() => ({}));
      // ★ apiFetch 는 throw 하지 않는다 — r.ok 를 안 보면 실패해도 성공한 척 빈 화면이 된다.
      if (!r.ok || !j.success) {
        setErr(r.status === 429
          ? (t('authDiag.errRate', { defaultValue: '잠시 후 다시 시도해 주세요. (분당 조회 횟수 제한)' }) as string)
          : (t('authDiag.errFailed', { defaultValue: '조회하지 못했어요.' }) as string));
        return;
      }
      setResult(j.data);
    } finally { setBusy(false); }
  }, [base, selected, selector, busy, t]);

  const label = (k: string) => ({ spf: 'SPF', dkim: 'DKIM', dmarc: 'DMARC' } as Record<string, string>)[k] || k;

  // 상태 문구 — 확인 가능한 것만 확인됐다고 말한다. DKIM 에는 "없음" 이 없다(부재를 증명할 수 없다).
  const statusText = (c: Check) => {
    switch (c.status) {
      case 'ok': return t('authDiag.ok', { defaultValue: '확인됨' }) as string;
      case 'missing': return t('authDiag.missing', { defaultValue: '없음' }) as string;
      case 'conflict': return t('authDiag.conflict', { defaultValue: '중복 — 수신 서버가 오류로 처리' }) as string;
      case 'lookup_failed': return t('authDiag.lookupFailed', { defaultValue: '조회 실패' }) as string;
      default: return t('authDiag.unknown', { defaultValue: '판별 불가' }) as string;
    }
  };
  const advice = (c: Check) => {
    if (c.status === 'ok') return '';
    if (c.key === 'dkim' && c.status === 'unknown') {
      return c.reason === 'wildcard_dns'
        ? (t('authDiag.dkimWildcard', { defaultValue: '이 도메인은 어떤 이름을 물어도 응답하도록 설정돼 있어(와일드카드 DNS), DNS 만으로는 DKIM 유무를 증명할 수 없어요. 메일 제공자 관리 화면의 selector 를 아래에 넣으면 그 값으로 확인합니다.' }) as string)
        : (t('authDiag.dkimUnknown', { defaultValue: '흔히 쓰는 selector 로는 찾지 못했어요. selector 를 모르면 DNS 로 "없다"는 것을 증명할 수 없습니다 — 메일 제공자 관리 화면의 selector 를 아래에 넣어 확인해 주세요.' }) as string);
    }
    if (c.key === 'spf' && c.status === 'missing') return t('authDiag.spfMissing', { defaultValue: '메일 제공자가 안내하는 SPF 레코드를 도메인 DNS 에 TXT 로 추가하세요.' }) as string;
    if (c.key === 'spf' && c.status === 'conflict') return t('authDiag.spfConflict', { defaultValue: 'SPF 레코드가 두 개 이상입니다. 하나로 합쳐야 합니다 — 수신 서버는 이 경우 검사를 오류로 처리합니다.' }) as string;
    if (c.key === 'dmarc' && c.status === 'missing') return t('authDiag.dmarcMissing', { defaultValue: '_dmarc 하위에 TXT 레코드를 추가하세요. 처음에는 관찰만 하는 p=none 으로 시작하는 것이 안전합니다.' }) as string;
    if (c.status === 'lookup_failed') return t('authDiag.lookupFailedHint', { defaultValue: 'DNS 응답이 없었습니다. 없다는 뜻이 아니라 확인하지 못했다는 뜻이에요 — 잠시 후 다시 시도해 주세요.' }) as string;
    return '';
  };

  if (domains.length === 0) return null;

  return (
    <Wrap>
      <Head><Title>{t('authDiag.title', { defaultValue: '도메인 인증 (발신 신뢰도)' }) as string}</Title></Head>
      <Desc>
        {t('authDiag.desc', { defaultValue: '보내는 메일이 스팸으로 분류되지 않으려면 도메인에 SPF·DKIM·DMARC 가 설정돼 있어야 해요. 지금 실제 DNS 를 조회해 상태를 보여줍니다.' }) as string}
      </Desc>

      <Row>
        {/* raw <select> 금지 — 공용 PlanQSelect (가드 규칙) */}
        <SelectWrap>
          <PlanQSelect
            size="sm"
            isSearchable={false}
            isDisabled={busy}
            aria-label={t('authDiag.domainLabel', { defaultValue: '진단할 도메인' }) as string}
            value={selected ? { value: selected, label: selected } : null}
            onChange={(opt) => { setSelected(((opt as PlanQSelectOption | null)?.value as string) || ''); setResult(null); }}
            options={domains.map((d) => ({ value: d, label: d }))}
          />
        </SelectWrap>
        <Input
          type="text" value={selector} disabled={busy}
          onChange={(e) => setSelector(e.target.value)}
          placeholder={t('authDiag.selectorPh', { defaultValue: 'DKIM selector (선택 — 알면 입력)' }) as string}
        />
        <ActionButton tone="secondary" size="sm" onClick={run} loading={busy} disabled={!selected}>
          {t('authDiag.run', { defaultValue: '진단' }) as string}
        </ActionButton>
      </Row>
      {err && <ErrText>{err}</ErrText>}

      {result && (
        <>
          {result.wildcard_dns && (
            <WildNote>
              {t('authDiag.wildcardNote', { defaultValue: '이 도메인은 존재하지 않는 이름에도 응답합니다(와일드카드 DNS). 그래서 "이름이 있다"는 사실은 증거가 되지 않고, 레코드 내용으로만 판정합니다.' }) as string}
            </WildNote>
          )}
          <List>
            {(['spf', 'dkim', 'dmarc'] as const).map((k) => {
              const c = result.checks[k];
              const tip = advice(c);
              return (
                <Item key={k}>
                  <ItemHead>
                    <Name>{label(k)}</Name>
                    <Badge $s={c.status}>{statusText(c)}</Badge>
                    {c.selector && <Sel>selector: {c.selector}</Sel>}
                  </ItemHead>
                  {c.records.length > 0 && <Record>{c.records[0]}</Record>}
                  {tip && <Tip>{tip}</Tip>}
                </Item>
              );
            })}
          </List>
        </>
      )}

      <Note>
        {t('authDiag.note', { defaultValue: 'PlanQ 는 DNS 를 대신 바꿔주지 않습니다. 레코드 추가는 도메인을 등록한 곳(가비아·후이즈·Cloudflare 등)의 DNS 관리 화면에서 해요. 결과는 10분간 보관되며, 그 뒤 다시 조회합니다.' }) as string}
      </Note>
    </Wrap>
  );
}

const Wrap = styled.div`display:flex;flex-direction:column;gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid #F1F5F9;`;
const Head = styled.div`display:flex;align-items:center;justify-content:space-between;`;
const Title = styled.div`font-size:13px;font-weight:700;color:#0F172A;`;
const Desc = styled.p`margin:0;font-size:12px;color:#94A3B8;line-height:1.6;`;
const Row = styled.div`display:flex;align-items:center;gap:6px;flex-wrap:wrap;`;
const SelectWrap = styled.div`flex:0 1 220px;min-width:160px;`;
const Input = styled.input`
  /* 넓은 화면에서 한 줄 입력이 1,150px 까지 늘어나던 것 — 다른 설정 입력과 같은 상한. */
  flex:1;min-width:180px;max-width:420px;height:32px;padding:0 10px;
  border:1px solid #E2E8F0;border-radius:8px;font-size:12px;color:#334155;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,.15);}
`;
const WildNote = styled.p`
  margin:0;padding:8px 10px;border-radius:8px;background:#FFFBEB;border:1px solid #FDE68A;
  font-size:11px;color:#92400E;line-height:1.6;
`;
const List = styled.div`display:flex;flex-direction:column;gap:6px;`;
const Item = styled.div`padding:10px;border:1px solid #E2E8F0;border-radius:8px;background:#fff;display:flex;flex-direction:column;gap:6px;`;
const ItemHead = styled.div`display:flex;align-items:center;gap:8px;flex-wrap:wrap;`;
const Name = styled.span`font-size:12px;font-weight:700;color:#0F172A;min-width:48px;`;
const TONE: Record<string, { bg: string; fg: string; bd: string }> = {
  ok: { bg: '#F0FDFA', fg: '#0F766E', bd: '#CCFBF1' },
  missing: { bg: '#FEF2F2', fg: '#DC2626', bd: '#FECACA' },
  conflict: { bg: '#FFFBEB', fg: '#D97706', bd: '#FDE68A' },
  lookup_failed: { bg: '#FFFBEB', fg: '#D97706', bd: '#FDE68A' },
  unknown: { bg: '#F1F5F9', fg: '#475569', bd: '#CBD5E1' },
};
const Badge = styled.span<{ $s: string }>`
  padding:1px 8px;border-radius:999px;font-size:10px;font-weight:700;
  background:${(p) => (TONE[p.$s] || TONE.unknown).bg};
  color:${(p) => (TONE[p.$s] || TONE.unknown).fg};
  border:1px solid ${(p) => (TONE[p.$s] || TONE.unknown).bd};
`;
const Sel = styled.span`font-size:11px;color:#94A3B8;`;
const Record = styled.code`
  display:block;padding:6px 8px;border-radius:6px;background:#F8FAFC;border:1px solid #E2E8F0;
  font-size:11px;color:#334155;word-break:break-all;line-height:1.5;
`;
const Tip = styled.p`margin:0;font-size:11px;color:#64748B;line-height:1.6;`;
const ErrText = styled.div`font-size:11px;font-weight:600;color:#B45309;`;
const Note = styled.p`
  margin:2px 0 0;padding:8px 10px;border-radius:8px;background:#F8FAFC;border:1px solid #E2E8F0;
  font-size:11px;color:#64748B;line-height:1.6;
`;
