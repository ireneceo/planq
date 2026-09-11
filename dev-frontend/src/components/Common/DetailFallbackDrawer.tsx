// DetailFallbackDrawer — 목록에 없는 딥링크를 못 열었을 때 **우측 상세 자리에서 이유를 말한다** (Q6 · 2026-09-11)
//
// 상세를 목록에서 골라 여는 화면(캘린더·청구서·파일)은 못 찾으면 드로어 자체가 안 떠 침묵했다.
// 상세 드로어와 같은 자리·같은 규격(DetailDrawer)에 DetailFallback 을 담는다 — 다른 워크스페이스 항목이면
// 내용 없이 "○○ 로 전환해서 열기"(OtherWorkspaceNotice). 상태는 hooks/useDirectDetail 이 만든다.
import { useTranslation } from 'react-i18next';
import DetailDrawer from './DetailDrawer';
import DetailFallback from './DetailFallback';
import type { DetailStatus } from '../../hooks/useDetailResource';

interface Props {
  /** null · loading · ready · idle 이면 닫혀 있다 */
  state: { status: DetailStatus; otherBiz: number | null } | null;
  onClose: () => void;
  width?: number;
}

export default function DetailFallbackDrawer({ state, onClose, width = 480 }: Props) {
  const { t } = useTranslation('common');
  const open = !!state && state.status !== 'loading' && state.status !== 'ready' && state.status !== 'idle';
  return (
    <DetailDrawer open={open} onClose={onClose} width={width} ariaLabel={t('detail.ariaLabel', '상세') as string}>
      {open && state && (
        <>
          <DetailDrawer.Header onClose={onClose}>{null}</DetailDrawer.Header>
          <DetailDrawer.Body>
            <DetailFallback status={state.status} businessId={state.otherBiz} onBack={onClose} />
          </DetailDrawer.Body>
        </>
      )}
    </DetailDrawer>
  );
}
