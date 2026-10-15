// ModuleGate — 워크스페이스 기능이 꺼져 있으면 그 화면을 «없는 화면» 으로 그린다(2026-10-15 — docs/PAYROLL_DESIGN.md §2.2).
//   판정 값은 /api/auth/me 의 modules·can_manage_payroll(서버 services/modules·payrollAccess 와 같은 값).
//   ★ «켜 달라» 안내가 아니라 없는 화면이다 — 서버도 404 로 있는지조차 말하지 않는다.
//   급여는 관리자(owner + 지정 담당자)만 화면을 연다 — 아니면 같은 없는 화면.
import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import DetailFallback from './DetailFallback';

export default function ModuleGate({ module, children }: { module: 'payroll'; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  const on = module === 'payroll' ? !!(user.modules?.payroll && user.can_manage_payroll) : false;
  if (!on) return <DetailFallback status="not_found" />;
  return <>{children}</>;
}
