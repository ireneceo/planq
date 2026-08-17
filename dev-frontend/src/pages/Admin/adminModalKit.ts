// /admin/* 모달 공용 프리미티브 — AdminBusinessesPage 와 그 하위 모달들이 공유한다.
//
// 왜 절출했나 (운영 #275 사이클):
//   결제 면제 모달을 AdminBusinessesPage 안에 두었더니 921줄로 god-file 래칫이 깨졌다.
//   베이스라인을 올려 삼키는 대신(CLAUDE.md — 게이트가 깨지면 절출한다) 모달을 별도 파일로
//   빼면서, 두 곳이 같은 규격을 쓰도록 스타일 정본을 여기 한 벌만 둔다.
//   ad-hoc styled 를 새로 만들지 말고 여기서 import 할 것.
import styled from 'styled-components';

export const ModalOverlay = styled.div`
  position: fixed; inset: 0; z-index: 90;
  background: rgba(15,23,42,0.28);
  display: flex; align-items: center; justify-content: center; padding: 20px;
  @media (max-width: 640px) { padding: 0; align-items: stretch; }
`;
export const Dialog = styled.div`
  background: #fff; border-radius: 14px; width: 100%; max-width: 460px;
  box-shadow: 0 20px 50px rgba(15,23,42,0.2);
  display: flex; flex-direction: column; overflow: hidden;
  max-height: calc(100vh - 40px);
  @media (max-width: 640px) {
    max-width: none; border-radius: 0;
    margin-top: 60px; max-height: calc(100vh - 60px); max-height: calc(100dvh - 60px);
  }
`;
export const DTitle = styled.div`padding: 18px 20px 8px; font-size: 15px; font-weight: 700; color: #0F172A;`;
export const DBody = styled.div`padding: 0 20px 16px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto;`;
export const DDesc = styled.p`font-size: 13px; color: #475569; line-height: 1.5; margin: 0;`;
export const DFooter = styled.div`
  padding: 12px 20px; border-top: 1px solid #E2E8F0;
  display: flex; gap: 8px; justify-content: flex-end; align-items: center;
`;
export const DError = styled.div`font-size: 12px; color: #DC2626; background: #FEF2F2; padding: 8px 10px; border-radius: 6px;`;
export const FSpacer = styled.div`flex: 1;`;

export const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
export const FLabel = styled.label`font-size: 12px; font-weight: 600; color: #475569;`;
export const FValue = styled.div`font-size: 13px; color: #0F172A;`;
export const FHelp = styled.div`font-size: 11px; color: #94A3B8; line-height: 1.4;`;

export const PlanOptions = styled.div`display: flex; gap: 6px; flex-wrap: wrap;`;
export const PlanOption = styled.button<{ $active: boolean }>`
  all: unset; cursor: pointer; padding: 6px 4px; border-radius: 8px;
  border: 1px solid ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  background: ${p => p.$active ? '#F0FDFA' : '#fff'};
  transition: all 0.15s;
  &:hover { border-color: #CBD5E1; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;

export const DateTrigger = styled.button`
  height: 34px; padding: 0 10px; border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 13px; color: #0F172A; font-family: inherit; background: #fff;
  text-align: left; cursor: pointer; display: inline-flex; align-items: center;
  &:hover { border-color: #94A3B8; }
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
export const DatePH = styled.span`color: #94A3B8;`;
export const TextArea = styled.textarea`
  padding: 8px 10px; border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 13px; color: #0F172A; font-family: inherit; resize: vertical; min-height: 60px;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;

export const PrimaryBtn = styled.button`
  height: 34px; padding: 0 16px; background: #14B8A6; color: #fff; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s;
  &:hover:not(:disabled){ background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;
export const SecondaryBtn = styled.button`
  height: 30px; padding: 0 12px; background: #fff; color: #0F172A;
  border: 1px solid #CBD5E1; border-radius: 8px; font-size: 12px; font-weight: 600;
  cursor: pointer;
  &:hover:not(:disabled){ background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

// 결제 면제 뱃지 (운영 #275) — 유료 플랜 뱃지와 구분되게 teal 계열.
export const ExemptBadge = styled.span`
  display:inline-flex;align-items:center;
  padding:2px 8px;border-radius:999px;
  background:#F0FDFA;color:#0F766E;border:1px solid #5EEAD4;
  font-size:11px;font-weight:700;letter-spacing:-0.1px;white-space:nowrap;
`;
