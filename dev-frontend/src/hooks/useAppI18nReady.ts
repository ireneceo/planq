// 앱 화면(로그인 뒤)은 번역 33개가 다 온 뒤 처음 그린다 — 한 번 준비되면 다시 막지 않는다 (2026-11-03 첫 길 점검).
//
// 왜: 새로 가입한 사람·초대받은 고객의 첫 화면에 1~2.5초 동안 «widget.start»·«stage.label»·«dashboard.scopeCompany» 같은
//   번역 이름이 그대로 보였다(실측 — 사이드바 근무·업무 흐름 칸, Q sales 필터, 대시보드 범위 탭). 번역이 늦게 온 이름공간을 쓰는
//   칸만 이름으로 그려진 것이다. 공개 첫 화면은 I18nReady 가 같은 일을 한다(2026-11-01) — 앱 쪽에만 문이 없었다.
//   이름이 보이는 것보다 잠깐 로딩 화면이 낫다.
// ★ 한 번 준비되면 계속 그린다 — 언어를 바꿀 때마다 앱 전체를 내렸다 올리면 열린 탭·쓰던 글이 날아간다.
// ★ 번역이 끝내 안 와도(네트워크) 8초 뒤엔 그린다 — 영영 빈 화면은 이름이 보이는 것보다 나쁘다.
import { useEffect, useState } from 'react';
import i18n, { ALL_NS } from '../i18n';

const allLoaded = () => {
  try { return ALL_NS.every((ns) => i18n.hasLoadedNamespace(ns)); } catch { return false; }
};

export function useAppI18nReady(need: boolean): boolean {
  const [ready, setReady] = useState(allLoaded);
  useEffect(() => {
    if (ready || !need) return;
    let alive = true;
    const done = () => { if (alive) setReady(true); };
    i18n.loadNamespaces(ALL_NS).then(done, done);
    const timer = window.setTimeout(done, 8000);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [need, ready]);
  // 그리는 순간 이미 다 와 있으면 문을 닫지 않는다 — 로그인·가입 화면에서 막 로그인된 순간(번역은 뒤에서 이미 받음)에
  //   한 프레임이라도 로딩 화면을 끼우면 그 화면 트리가 내려갔다 올라가 이동이 끊긴다.
  return ready || !need || allLoaded();
}
