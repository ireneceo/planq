import { isNativeApp } from '../services/native';

/**
 * 앱 안에서 구독 구매 표면을 노출해도 되는가.
 *
 * App Store Guideline 3.1.1 (In-App Purchase):
 *   앱에서 사용하는 디지털 구독은 Apple 인앱결제로만 팔 수 있다. 외부 결제 수단으로
 *   유도하는 버튼·링크·CTA 자체가 리젝 사유다. PlanQ 는 Stripe/계좌이체로 받으므로
 *   네이티브 앱에서는 구매 표면을 아예 노출하지 않는다.
 *
 * 그래서 네이티브에서는:
 *   - 플랜 업그레이드·다운그레이드·체험 시작 버튼 숨김
 *   - CheckoutModal(결제 진입) 자체를 렌더하지 않음
 *   - "지금 업그레이드" 계열 배너 CTA 숨김
 *   - 현재 플랜·사용량은 그대로 보여준다 (읽기 전용은 규정 위반이 아님)
 *
 * 구매 경로를 웹으로 안내하는 문구도 두지 않는다 — 외부 구매 유도로 읽힐 수 있다.
 *
 * ※ Q Bill 고객 청구서 결제(PublicInvoicePage)는 대상이 아니다. 실물 용역 대금이라
 *   Guideline 3.1.3(e) 허용 범위 — 여기서 막으면 제품 기능이 죽는다.
 */
export const canPurchaseInApp = (): boolean => !isNativeApp();
