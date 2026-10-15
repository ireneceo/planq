// DefaultRoleField — 멤버의 «기본 역할» 고르기 + 자동저장 (설정 > 멤버 상세, 2026-10-15)
//   기본 역할은 프로젝트에 이 사람을 넣을 때 미리 채워지는 값이다. 목록은 워크스페이스 역할 사전(RolePicker).
//   저장은 PATCH /api/businesses/:biz/members/:id/default-role — 서버가 사전을 거쳐(없으면 추가) 저장한다.
//   ★ 호출측은 key={memberId} 로 인스턴스를 가른다(대상이 바뀌는 자동저장 칸 — 가드 autosavekey).
// autosave-key-exempt: 이 컴포넌트는 멤버 한 명 전용이다 — 상태(current·latest)까지 갈라야 해서 key 는 호출측(WorkspaceSettingsPage)이 단다
import React, { useRef, useState } from 'react';
import AutoSaveField, { type AutoSaveHandle } from '../Common/AutoSaveField';
import { apiFetch } from '../../contexts/AuthContext';
import RolePicker from './RolePicker';
import type { MemberRoleEntry } from './memberRoleApi';

interface Props {
  businessId: number;
  memberId: number;
  value: string | null;
  dict: MemberRoleEntry[];
  onDictAdd?: (entry: MemberRoleEntry) => void;
  onManage?: () => void;
  onSaved?: () => void | Promise<void>;
}

const DefaultRoleField: React.FC<Props> = ({ businessId, memberId, value, dict, onDictAdd, onManage, onSaved }) => {
  const handle = useRef<AutoSaveHandle>(null);
  const [current, setCurrent] = useState<string | null>(value);
  // 최신값은 클로저가 아니라 ref 로 읽는다(CLAUDE.md 자동저장 — 클릭으로 바뀐 값을 저장해야 한다)
  const latest = useRef<string | null>(value);

  return (
    <AutoSaveField ref={handle} type="select" style={{ maxWidth: 220 }} onSave={async () => {
      const r = await apiFetch(`/api/businesses/${businessId}/members/${memberId}/default-role`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_role: latest.current }),
      });
      const j = await r.json().catch(() => null);
      // 실패는 던진다 — ! 뱃지가 떠야 한다(삼키면 값만 슬쩍 되돌아간다)
      if (!r.ok || !j?.success) { setCurrent(value); latest.current = value; throw new Error(j?.message || 'save failed'); }
      await onSaved?.();
    }}>
      <RolePicker bizId={businessId} dict={dict} onDictAdd={onDictAdd} onManage={onManage}
        value={current} testId="member-default-role"
        onChange={(v) => {
          if ((v || null) === (latest.current || null)) return;
          latest.current = v; setCurrent(v);
          handle.current?.triggerSave();
        }} />
    </AutoSaveField>
  );
};

export default DefaultRoleField;
