// SalesIntakeSection — 설정 › 권한 «상담 유입» 카드 (#449, docs/SALES_INTAKE_DESIGN.md §4.1)
//
// 메일이 Q sales 상담으로 **어떻게** 들어오는지 정한다.
//   수동 — 메일·채팅에서 [상담으로 보내기] 한 것만 (기본값, Irene 결정 2026-10-02)
//   자동 — 답장한 상대·개인 주소에서 온 메일도 들어온다(종전 기준)
// 채팅·게스트 링크는 모드와 무관하다(우리 창구로 들어온 사람).
// ★ 바꿔도 메일·원장은 그대로다 — 상담 목록은 원본에서 파생되므로 되돌리면 그대로 돌아온다.
// ★ 고치는 사람은 고객 창구 카드와 같은 판정(owner) — 서버 assertEntryAdmin 과 같은 값.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import AutoSaveField from '../Common/AutoSaveField';
import { SegmentedToggle, SegmentedBtn } from '../Common/segmentedToggle';
import { saveSalesIntake } from '../../services/sale';

type Mode = 'manual' | 'auto';
interface Props { businessId: number; isOwner: boolean }

const SalesIntakeSection: React.FC<Props> = ({ businessId, isOwner }) => {
  const { t } = useTranslation('settings');
  const [mode, setMode] = useState<Mode | null>(null);
  // 래퍼가 저장할 때 **최신값**을 읽는다 — 클로저는 클릭 전 값을 본다(자동저장 절).
  const modeRef = useRef<Mode | null>(null);
  modeRef.current = mode;
  const savedRef = useRef<Mode | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await apiFetch(`/api/businesses/${businessId}/customer-entry`);
      const j = await r.json().catch(() => null);
      if (!alive || !r.ok || !j?.success) return;
      const m: Mode = j.data?.sales_intake?.mail === 'auto' ? 'auto' : 'manual';
      savedRef.current = m;
      setMode(m);
    })();
    return () => { alive = false; };
  }, [businessId]);

  const persist = async () => {
    const m = modeRef.current;
    if (!m || m === savedRef.current) return;
    try {
      await saveSalesIntake(businessId, m);
      savedRef.current = m;
    } catch (e) {
      setMode(savedRef.current);      // 실패하면 되돌리고 던진다 — 래퍼가 ! 를 띄운다
      throw e;
    }
  };

  if (!mode) return null;
  return (
    <Card data-testid="sales-intake-card">
      <Head>
        <Title>{t('salesIntake.title') as string}</Title>
        <Desc>{t('salesIntake.mail.label') as string}</Desc>
      </Head>
      <AutoSaveField type="toggle" onSave={persist}>
        <SegmentedToggle role="radiogroup" aria-label={t('salesIntake.mail.label') as string}>
          {(['manual', 'auto'] as Mode[]).map((m) => (
            <SegmentedBtn key={m} type="button" role="radio" aria-checked={mode === m}
              data-testid={`sales-intake-${m}`}
              $active={mode === m} disabled={!isOwner}
              onClick={() => setMode(m)}>
              {t(`salesIntake.mail.${m}Short`) as string}
            </SegmentedBtn>
          ))}
        </SegmentedToggle>
      </AutoSaveField>
      <Explain>{t(`salesIntake.mail.${mode}`) as string}</Explain>
      <Hint>{t('salesIntake.mail.hint') as string}</Hint>
      {!isOwner && <Hint>{t('salesIntake.ownerOnly') as string}</Hint>}
    </Card>
  );
};

export default SalesIntakeSection;

const Card = styled.div`
  background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;
  display:flex;flex-direction:column;gap:10px;align-items:flex-start;
`;
const Head = styled.div`display:flex;flex-direction:column;gap:4px;`;
const Title = styled.div`font-size:0.9375rem;font-weight:700;color:#0f172a;`;
const Desc = styled.div`font-size:0.8125rem;color:#64748b;line-height:1.5;`;
const Explain = styled.div`font-size:0.8125rem;color:#334155;line-height:1.5;`;
const Hint = styled.div`font-size:0.75rem;color:#94a3b8;line-height:1.5;`;
