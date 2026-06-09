// 추가 슬롯 (Add-on) — 플랜 위에 멤버·고객·Q Note·Cue·스토리지 추가 구매
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { fetchAddons, requestAddon, type AddonItem, type AddonStatus, type AddonField, formatBytes, formatMinutes } from '../../services/plan';
import { mapApiError } from '../../utils/apiError';

interface Props {
  businessId: number;
  isOwner: boolean;
}

const AddonSection: React.FC<Props> = ({ businessId, isOwner }) => {
  const { t } = useTranslation('settings');
  const { t: tErr } = useTranslation('errors');
  const [data, setData] = useState<AddonStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [requestingCode, setRequestingCode] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});

  const reload = async () => {
    setLoading(true);
    try {
      const d = await fetchAddons(businessId);
      setData(d);
      setErr(null);
    } catch (e) {
      setErr(mapApiError(e, tErr));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [businessId]);

  const handleRequest = async (item: AddonItem) => {
    if (requestingCode) return;
    const quantity = Math.max(1, Math.min(100, Number(qty[item.code]) || 1));
    setRequestingCode(item.code);
    setResultMsg(null);
    try {
      const r = await requestAddon(businessId, item.code, quantity);
      setResultMsg(t('addon.requestOk', '신청 접수 — 입금 안내 메일이 발송됩니다 ({{krw}}원, {{units}})', {
        krw: r.total_krw.toLocaleString('ko-KR'),
        units: r.total_units.toLocaleString('ko-KR'),
      }) as string);
      await reload();
    } catch (e) {
      setResultMsg(t('addon.requestErr', '신청 실패: {{msg}}', { msg: mapApiError(e, tErr) }) as string);
    } finally {
      setRequestingCode(null);
    }
  };

  if (loading) return <Loading>{t('common.loading', '불러오는 중...')}</Loading>;
  if (err) return <ErrorBanner>{err}</ErrorBanner>;
  if (!data || data.catalog.length === 0) return null;

  // 현재 보유 표시 — 0 보다 큰 것만
  const ownedFields: { field: AddonField; label: string; value: string }[] = [];
  if (data.current.addon_members > 0) ownedFields.push({ field: 'addon_members', label: t('addon.fields.members', '멤버 추가') as string, value: `+${data.current.addon_members}명` });
  if (data.current.addon_clients > 0) ownedFields.push({ field: 'addon_clients', label: t('addon.fields.clients', '고객 슬롯 추가') as string, value: `+${data.current.addon_clients}명` });
  if (data.current.addon_qnote_minutes > 0) ownedFields.push({ field: 'addon_qnote_minutes', label: t('addon.fields.qnote', 'Q Note 시간 추가') as string, value: `+${formatMinutes(data.current.addon_qnote_minutes)}` });
  if (data.current.addon_cue_actions > 0) ownedFields.push({ field: 'addon_cue_actions', label: t('addon.fields.cue', 'Cue 액션 추가') as string, value: `+${data.current.addon_cue_actions.toLocaleString()}회` });
  if (data.current.addon_storage_bytes > 0) ownedFields.push({ field: 'addon_storage_bytes', label: t('addon.fields.storage', '스토리지 추가') as string, value: `+${formatBytes(data.current.addon_storage_bytes)}` });

  return (
    <Wrap>
      <Head>
        <Title>{t('addon.title', '추가 슬롯 (Add-on)')}</Title>
        <Desc>{t('addon.desc', '현재 플랜의 한도를 넘는 멤버·고객·Q Note 시간 등을 월 단위로 추가 구매할 수 있습니다.')}</Desc>
      </Head>

      {ownedFields.length > 0 && (
        <OwnedBox>
          <OwnedTitle>{t('addon.currentlyAdded', '현재 추가된 슬롯')}</OwnedTitle>
          <OwnedRow>
            {ownedFields.map((o) => (
              <OwnedItem key={o.field}>
                <OwnedLabel>{o.label}</OwnedLabel>
                <OwnedValue>{o.value}</OwnedValue>
              </OwnedItem>
            ))}
          </OwnedRow>
        </OwnedBox>
      )}

      <Grid>
        {data.catalog.map((item) => {
          const q = Number(qty[item.code]) || 1;
          const totalKrw = (item.price_monthly?.KRW || 0) * q;
          return (
            <Card key={item.code}>
              <CardName>{item.name_ko}</CardName>
              <CardPrice>
                {(item.price_monthly?.KRW || 0).toLocaleString('ko-KR')}원
                <PriceUnit>{t('addon.perMonth', '/ 월')}</PriceUnit>
              </CardPrice>
              {isOwner && (
                <BuyRow>
                  <QtyInput
                    type="number" min={1} max={100} value={q}
                    onChange={(e) => setQty({ ...qty, [item.code]: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
                  />
                  <BuyBtn type="button" disabled={!!requestingCode} onClick={() => handleRequest(item)}>
                    {requestingCode === item.code ? t('addon.requesting', '신청 중...') : t('addon.requestBuy', '신청하기')}
                  </BuyBtn>
                  <TotalPrice>{totalKrw.toLocaleString('ko-KR')}원</TotalPrice>
                </BuyRow>
              )}
            </Card>
          );
        })}
      </Grid>

      {resultMsg && <ResultMsg>{resultMsg}</ResultMsg>}

      <FootNote>
        {t('addon.footNote', '신청 접수 후 운영자가 입금 안내 메일을 발송합니다. 입금이 확인되면 다음 영업일 내 자동 적용됩니다. 매월 자동 갱신은 다음 업데이트에서 지원될 예정입니다.')}
      </FootNote>
    </Wrap>
  );
};

export default AddonSection;

// ─── styled ───
const Wrap = styled.section`display: flex; flex-direction: column; gap: 14px;`;
const Loading = styled.div`text-align: center; padding: 24px; color: #94A3B8; font-size: 12px;`;
const ErrorBanner = styled.div`padding: 10px 14px; background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B; border-radius: 8px; font-size: 12px;`;
const Head = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const Title = styled.h3`font-size: 15px; font-weight: 700; color: #0F172A; margin: 0;`;
const Desc = styled.div`font-size: 12px; color: #64748B; line-height: 1.5;`;

const OwnedBox = styled.div`
  background: #F0FDFA; border: 1px solid #CCFBF1; border-radius: 10px;
  padding: 12px 16px; display: flex; flex-direction: column; gap: 8px;
`;
const OwnedTitle = styled.div`
  font-size: 11px; font-weight: 700; color: #0F766E;
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const OwnedRow = styled.div`display: flex; flex-wrap: wrap; gap: 12px 24px;`;
const OwnedItem = styled.div`display: flex; flex-direction: column; gap: 2px;`;
const OwnedLabel = styled.div`font-size: 11px; color: #0F766E;`;
const OwnedValue = styled.div`font-size: 13px; font-weight: 700; color: #0F172A; font-variant-numeric: tabular-nums;`;

const Grid = styled.div`
  display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px;
`;
const Card = styled.div`
  border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 8px; background: #fff;
`;
const CardName = styled.div`font-size: 13px; font-weight: 700; color: #0F172A;`;
const CardPrice = styled.div`font-size: 18px; font-weight: 800; color: #0F766E; line-height: 1.1;`;
const PriceUnit = styled.span`font-size: 11px; font-weight: 500; color: #94A3B8; margin-left: 4px;`;
const BuyRow = styled.div`display: flex; align-items: center; gap: 8px; margin-top: 4px;`;
const QtyInput = styled.input`
  width: 56px; height: 28px; padding: 0 8px;
  border: 1px solid #E2E8F0; border-radius: 6px; font-size: 12px;
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;
const BuyBtn = styled.button`
  height: 28px; padding: 0 12px;
  background: #14B8A6; color: #fff; border: none; border-radius: 6px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const TotalPrice = styled.div`
  margin-left: auto; font-size: 12px; font-weight: 700; color: #475569;
  font-variant-numeric: tabular-nums;
`;
const ResultMsg = styled.div`
  font-size: 12px; color: #0D9488; line-height: 1.5;
  padding-left: 4px;
`;
const FootNote = styled.div`
  font-size: 11px; color: #94A3B8; line-height: 1.5;
  padding-top: 4px;
`;
