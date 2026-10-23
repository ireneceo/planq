---
paths:
  - "dev-backend/routes/leave.js"
  - "dev-backend/routes/business_leave_types.js"
  - "dev-backend/services/leave*"
  - "dev-frontend/src/pages/Attendance/**"
  - "dev-frontend/src/components/Attendance/**"
  - "dev-frontend/src/pages/Settings/LeaveTypeSettingsSection.tsx"
  - "dev-frontend/src/pages/Settings/AttendanceAdminSettings.tsx"
  - "dev-frontend/src/pages/Payroll/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 휴가 종류(leave_types)

**휴가 종류 (1, 2026-10-22):** **leave_types** — 워크스페이스가 직접 등록·관리하는 휴가 종류(시스템 5종 code annual·sick·family·other·unpaid + 커스텀 · 이름 · 유급/무급 `pay` · 연간 기본 일수 = 부여 폼 기본값, 자동 부여 아님). 부여·신청은 `leave_type_id` 로 가리키고 **유급/무급은 종류가 정한다** — 신청 행 `leave_type` 은 신청 시점 박제라 잔여·통계·급여 무급 일할은 그 박제만 읽는다(종류를 고쳐도 옛 신청·잔여·급여 불변). 쓰인 종류는 pay 불변·삭제 불가(끄기만). 읽고 쓰는 문 `services/leaveTypes`(resolveType 이 business_id 를 건다) · 화면 설정 › 근태 관리 맨 위 «휴가 설정». 옛 `category` ENUM 은 한 릴리즈 동안 쓰기만(롤백용) — 가드 `--category=leavetypes` 가 목록 리터럴·옛 칸 읽기를 막는다. 운영 `migrate-leave-types.js`(배포 슬롯, 롤백 `--rollback-nullable`). 설계 docs/LEAVE_TYPES_DESIGN.md

