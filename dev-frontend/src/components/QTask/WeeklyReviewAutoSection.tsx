// WeeklyReviewAutoSection — 주간 보고 자동 박제 설정 섹션
//
// NotificationSettings 페이지에 추가되는 섹션.
// 자동 박제 ON/OFF 토글.

import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import {
  getWeeklyReviewSettings,
  updateWeeklyReviewSettings,
} from '../../services/weeklyReview';

interface Props {
  businessId: number;
}

const WeeklyReviewAutoSection: React.FC<Props> = ({ businessId }) => {
  const { t } = useTranslation('qtask');
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const settings = await getWeeklyReviewSettings(businessId);
        setAutoEnabled(settings.auto_enabled);
      } catch (e) {
        // default ON
      } finally {
        setLoading(false);
      }
    })();
  }, [businessId]);

  const toggle = async () => {
    const newVal = !autoEnabled;
    setAutoEnabled(newVal);
    try {
      await updateWeeklyReviewSettings({ business_id: businessId, auto_enabled: newVal });
    } catch (e) {
      setAutoEnabled(!newVal); // rollback
    }
  };

  if (loading) return null;

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>{t('weeklyReview.auto.title', '주간 보고 자동 확정')}</SectionTitle>
      </SectionHeader>
      <SectionBody>
        <Description>{t('weeklyReview.auto.desc', '매주 일요일 23:59 자동으로 그 주 결산을 저장합니다.')}</Description>
        <ToggleRow>
          <ToggleLabel>{autoEnabled ? t('weeklyReview.auto.enabled', '켜짐') : t('weeklyReview.auto.disabled', '꺼짐')}</ToggleLabel>
          <ToggleSwitch onClick={toggle} $on={autoEnabled}>
            <ToggleKnob $on={autoEnabled} />
          </ToggleSwitch>
        </ToggleRow>
      </SectionBody>
    </Section>
  );
};

export default WeeklyReviewAutoSection;

// ─── Styles ───
const Section = styled.section`
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  margin-bottom: 16px;
`;

const SectionHeader = styled.div`
  padding: 14px 18px;
  border-bottom: 1px solid #f1f5f9;
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
`;

const SectionBody = styled.div`
  padding: 14px 18px;
`;

const Description = styled.p`
  margin: 0 0 12px;
  font-size: 13px;
  color: #64748b;
`;

const ToggleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const ToggleLabel = styled.span`
  font-size: 13px;
  color: #475569;
  min-width: 40px;
`;

const ToggleSwitch = styled.div<{ $on: boolean }>`
  width: 40px;
  height: 22px;
  background: ${p => p.$on ? '#14b8a6' : '#cbd5e1'};
  border-radius: 11px;
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
`;

const ToggleKnob = styled.div<{ $on: boolean }>`
  width: 18px;
  height: 18px;
  background: #fff;
  border-radius: 50%;
  position: absolute;
  top: 2px;
  left: ${p => p.$on ? '20px' : '2px'};
  transition: left 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
`;
