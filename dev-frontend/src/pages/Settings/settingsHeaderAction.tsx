// 설정 탭이 자기 화면의 **주요 액션**을 PageShell 헤더 우측에 올리는 통로.
//
// 왜 이렇게 하나
//   버튼을 부모(WorkspaceSettingsPage)가 직접 그리면 **권한 술어가 두 벌**이 된다. 실제로 그랬다 —
//   부모의 isAdmin 은 `owner || platform_admin` 인데 메일함 탭의 isAdmin 은 `owner || admin ||
//   platform_admin` 이라, 부모 기준으로 그리면 워크스페이스 admin 이 "계정 추가" 버튼을 영영 못 본다.
//   (memory feedback_predicate_must_match_both_sides — 게이트 술어는 양쪽이 같아야 한다.)
//   그래서 **권한과 핸들러를 아는 탭이 직접 등록**하고, 부모는 자리만 내준다.
//
// ★ 무한 렌더 방지가 이 파일의 핵심 설계다.
//   핸들러는 부모의 **ref** 에만 담고, 부모 state 에는 **label(문자열)** 만 둔다.
//   그래서 자식이 onClick 을 매 렌더 새로 만들어도 부모 state 가 안 바뀌고 → 재렌더가 안 일어나고
//   → 자식이 다시 등록하는 순환이 생기지 않는다. (state 에 JSX·객체를 담으면 그 순환이 생긴다.)
import { createContext, useContext, useEffect } from 'react';

export interface SettingsHeaderAction {
  /** 버튼에 보일 문구 (i18n 적용된 완성 문자열) */
  label: string;
  onClick: () => void;
}

type Publish = (action: SettingsHeaderAction | null) => void;

const Ctx = createContext<Publish | null>(null);
export const SettingsHeaderActionProvider = Ctx.Provider;

/**
 * 헤더 우측에 버튼 하나를 올린다. `null` 을 주면 내린다(권한 없음 등).
 * 언마운트 시 자동으로 내려간다 — 탭을 옮겼는데 옛 버튼이 남는 일이 없다.
 */
export function useSettingsHeaderAction(action: SettingsHeaderAction | null): void {
  const publish = useContext(Ctx);
  const label = action ? action.label : null;
  const onClick = action ? action.onClick : null;
  useEffect(() => {
    if (!publish) return undefined;
    publish(label && onClick ? { label, onClick } : null);
    return () => publish(null);
  }, [publish, label, onClick]);
}
