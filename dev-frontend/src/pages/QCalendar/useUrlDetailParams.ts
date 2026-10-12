// 이미 열린 캘린더에서 주소의 ?event= · ?task= 가 바뀌면 상세를 다시 연다 (2026-10-12).
//   Irene: «Cue가 일정을 추가한 후 등록했다고 해서 링크 따라가면 안열려».
//   캘린더는 이 값을 **마운트 때 한 번만** 읽었다. 캘린더를 보면서 Cue 로 일정을 만들고 [열기] 를 누르면
//   같은 화면이라 다시 마운트되지 않고(탭 모드는 openInNewTab 이 기존 캘린더 탭 주소만 바꾼다) 상세가 안 열렸다
//   (memory feedback_url_param_read_once_keepalive — 업무·문서·파일·Q info 는 이미 이렇게 고쳐져 있다).
//   «적용한 값» 을 기억한다 — 페이지의 URL 싱크가 같은 값을 다시 쓰므로, 값이 **바뀔 때만** 반영해야
//   사용자가 닫은 상세가 되살아나지 않는다.
import { useEffect, useRef } from 'react';

export function useUrlDetailParams(
  search: string,
  embedded: boolean,
  openEvent: (id: number) => void,
  openTask: (id: number) => void,
) {
  const first = new URLSearchParams(embedded ? '' : search);
  const applied = useRef({ event: first.get('event'), task: first.get('task') });   // 첫 값은 초기 상태가 이미 반영했다
  useEffect(() => {
    if (embedded) return;   // 프로젝트 탭에 얹혔을 때 주소는 주인 것이다
    const p = new URLSearchParams(search);
    const ev = p.get('event');
    const tk = p.get('task');
    if (ev !== applied.current.event) {
      applied.current.event = ev;
      if (ev && Number(ev) > 0) openEvent(Number(ev));
    }
    if (tk !== applied.current.task) {
      applied.current.task = tk;
      if (tk && Number(tk) > 0) openTask(Number(tk));
    }
  }, [search, embedded]); // eslint-disable-line react-hooks/exhaustive-deps -- 여는 함수는 setState(안정)
}
