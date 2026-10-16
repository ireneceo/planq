// 고객 «관리 기록» 절 묶음 — 사업자·증빙 · 정기 청구 · 메모. Q sale 패널과 상세 페이지가 **같은 순서로** 얹는다.
//   2026-10-16 설정 > 고객 화면을 Q sale 로 합치며 그 드로어에만 있던 것을 옮겼다(docs/CLIENT_SCREENS_MERGE_DESIGN.md).
//   변경 이력(감사)은 맨 아래에 따로 둔다 — ClientAuditHistory.
import type { SaleClientDetail } from '../../services/sale';
import ClientBillingInfoForm from './ClientBillingInfoForm';
import ClientNotesSection from './ClientNotesSection';
import ClientSubscriptions from './ClientSubscriptions';
import { Section } from './clientDetailStyles';

interface Props {
  businessId: number;
  client: SaleClientDetail;
  canManage: boolean;
  onSaved?: () => void;
}

export default function ClientRecordSections({ businessId, client, canManage, onSaved }: Props) {
  return (
    <>
      {client.billing && (
        <ClientBillingInfoForm key={`billing-${client.id}`} businessId={businessId} clientId={client.id}
          billing={client.billing} canEdit={canManage} onSaved={onSaved} />
      )}
      {/* 정기 청구 — 정식 고객(계정 고객·직접 관리 고객)만. 초대 수락 전·문의 고객은 아직 대상이 아니다 */}
      {(client.status === 'active' || client.status === 'managed') && (
        <Section data-testid="client-subscriptions-section">
          <ClientSubscriptions businessId={businessId} clientId={client.id} canWrite={canManage} />
        </Section>
      )}
      <ClientNotesSection key={`notes-${client.id}`} businessId={businessId} clientId={client.id}
        initial={client.notes || ''} canEdit={canManage} onSaved={onSaved} />
    </>
  );
}
