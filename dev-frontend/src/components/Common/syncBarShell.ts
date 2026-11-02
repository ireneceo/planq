// 다른 창·기기에서 바뀐 것을 «이 창도 따라갈까» 묻는 한 줄 — 워크스페이스·계정 전환이 같이 쓴다(베끼면 갈라진다).
import styled from 'styled-components';

// 화면 위쪽 가운데 한 줄 — 하던 일을 가리지 않게 작게. 모달이 아니다(포커스를 뺏지 않는다).
export const SyncBar = styled.div`
  position: fixed; left: 50%; transform: translateX(-50%);
  top: calc(var(--pq-chrome-bottom, 0px) + 8px);
  z-index: 1200;
  display: flex; align-items: center; gap: 10px;
  max-width: calc(100vw - 32px);
  padding: 8px 8px 8px 14px; border-radius: 10px;
  background: #0F172A; color: #F8FAFC;
  font-size: 0.8125rem; font-weight: 500;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25);
  span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
export const SyncApplyBtn = styled.button`
  flex-shrink: 0; min-height: 36px; padding: 0 12px; border-radius: 8px;
  border: none; background: #14B8A6; color: #FFFFFF;
  font-size: 0.8125rem; font-weight: 700; cursor: pointer;
  &:hover { background: #0D9488; }
  &:focus-visible { outline: 2px solid #99F6E4; outline-offset: 2px; }
`;
