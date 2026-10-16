// 고객 상세 읽기 + 못 읽었을 때의 이유 — 패널이 «불러오지 못함» 한 줄로 뭉개지 않게(2026-10-16).
//   옛 설정 > 고객 드로어는 `?client=` 가 남의 워크스페이스 고객이면 전환 안내를 보였다. 그 주소가 이제
//   Q sale 패널로 오므로 같은 판정(서버 한 곳 — findOtherWorkspaceOf)을 여기서 한다.
import { getSaleClient, type SaleClientDetail } from '../../services/sale';
import { findOtherWorkspaceOf } from '../../utils/workspaceMatch';
import type { DetailStatus } from '../../hooks/useDetailResource';

export interface ClientLoadResult { data?: SaleClientDetail; status?: DetailStatus; otherBiz?: number | null }

export async function loadClientOrFallback(businessId: number, clientId: number): Promise<ClientLoadResult> {
  try {
    return { data: await getSaleClient(businessId, clientId) };
  } catch (e) {
    const st = (e as { status?: number }).status;
    if (st === 404) {
      const other = await findOtherWorkspaceOf('client', clientId, businessId);
      return other ? { status: 'other_workspace', otherBiz: other } : { status: 'not_found' };
    }
    return { status: st === 403 ? 'forbidden' : 'error' };
  }
}
