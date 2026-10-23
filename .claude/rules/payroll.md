---
paths:
  - "dev-backend/routes/payroll*.js"
  - "dev-backend/services/payroll*"
  - "dev-backend/services/payslip.js"
  - "dev-backend/services/modules.js"
  - "dev-frontend/src/pages/Payroll/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 급여·계약

**급여·계약 (8, 2026-10-15 · 기능 스위치 `businesses.modules.payroll` 기본 꺼짐):** payroll_people · employment_contracts · pay_items · contract_pay_lines · payroll_runs · payroll_entries · payroll_entry_lines · payroll_status_history. 설계 docs/PAYROLL_DESIGN.md(§13 구현 메모)
- **PlanQ 는 급여를 «계산» 하지 않고 «정리·대조·확정» 한다** — 법정 공제는 세무사 대장 값이 정답(항목 calc `external`, 프리셋에 요율 숫자 없음). 금액 공식은 `services/payrollCalc` 한 벌(순수 함수, 검산 `node scripts/check-payroll-calc.js`).
- 상태 전이는 `services/payrollTransition` 한 문(초안 → 대조 → 확정·잠금 → 지급완료, 정정은 정정 회차로만). 대장 읽기 `services/payrollStatement`(xlsx·csv 기계 · PDF 만 AI · 주민번호/계좌 모양 가림 `maskSensitive` 한 벌).
- 보는 사람 = 대표 + 지정 급여 담당자(`services/payrollAccess` — admin 자동 아님 · platform_admin 백도어 없음) · 직원은 `/me/payslips` 자기 것만. 실시간은 `services/payrollSignal` 개인 방만(가드 broadcast) · AI·검색·Cue 에 급여 없음(가드 agentsurface·broadcast). 끄면 API 404(가드 modulegate).
- 송금 할 일 = `task_actions.createTask`(나만 보기·대외비·계좌번호 없음·멱등) · 명세서 알림 `payroll`(메일 없음). 운영 `migrate-payroll.js`(배포 슬롯).

