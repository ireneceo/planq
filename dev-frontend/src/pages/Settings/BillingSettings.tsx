// 청구 설정 — 통합 설정의 한 탭
// 발신자 정보(read-only) + 입금 계좌 + 청구서 기본값
// 실제 폼은 QBill/SettingsTab 재사용 (inWorkspaceSettings=true 로 "워크스페이스로 이동" 버튼 숨김)
import React from 'react';
import SettingsTab from '../QBill/SettingsTab';

interface Props {
  businessId: number;
  isOwner: boolean;
}

const BillingSettings: React.FC<Props> = () => {
  // SettingsTab 자체가 useAuth 로 businessId 읽으므로 prop 으로 다시 전달할 필요 없음
  return <SettingsTab inWorkspaceSettings={true} />;
};

export default BillingSettings;
