// 우측 상단 인앱 알림 toaster — 30년차 시각 핵심 원칙 적용:
//   1. Focus steal 금지 (modal X, focus 안 빼앗음)
//   2. Context-aware (활성 페이지/대화방 알림은 표시 X)
//   3. Notification fatigue 방지 (최대 3 개 stack, 5s 자동 페이드, hover 시 정지)
//   4. 사운드 ON — 짧은 ping (Web Audio API, 외부 mp3 의존성 X). 활성 conv skip 정책 그대로 유지.
//      OS 시스템 사운드 OFF / 데스크탑 PWA banner 만 보일 때 보조 신호.
//
// Architecture:
//   - 단일 socket (per user session) 으로 사용자 워크스페이스 room + 대화방 room 모두 구독
//   - 백엔드의 task:new, task:updated, inbox:refresh, message:new 모두 listen
//   - 'chat' (인앱) channel ON 일 때만 표시 (notification_prefs 매트릭스)
import { useEffect, useRef, useState, useCallback } from 'react';
import { chatAttachLine } from '../../utils/chatAttachLine';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import { useChromeLocation } from '../../hooks/useChromeNav';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { enterWorkspaceLink, WS_PARAM } from '../../utils/workspaceLink';
import { notificationRowToToastLink, openNotificationTarget, type NotificationFullRow } from '../../utils/notificationLink';
import NotificationTypeIcon from './NotificationTypeIcon';
import { ensureUnlock, playPing } from './notificationSound';

interface Toast {
  id: string;
  type: 'message' | 'task' | 'invoice' | 'signature' | 'event' | 'system';
  // 운영 #287 — 실제 Notification.event_kind. type 은 색·채널정책용 6분류라 종류를 다 담지 못한다
  //   (mail·invite·payment… 12종이 전부 'system' 으로 접혀 아이콘이 'i' 하나였다).
  //   아이콘은 이 값으로 그린다. 없으면 type 에서 역매핑.
  kind?: string;
  title: string;
  body?: string;
  link?: string;            // 클릭 시 이동 (resolveNotificationLink 통과한 값)
  contextKey?: string;      // 활성 페이지 매칭용 (예: conv:123, task:45)
  notificationId?: number;  // N+73 — DB Notification.id (있으면 닫기/클릭 시 mark-read 호출)
  urgent?: boolean;         // 긴급 업무요청(notification:new 의 urgent) — 빨간 띠로 강조
  // 지금 보는 곳이 아닌 워크스페이스의 알림 — 제목 위 이름 줄, 누르면 그 워크스페이스로 전환해 연다(2026-10-23)
  foreignBusinessId?: number; workspaceName?: string;
  ts: number;
}

// toast.type(6분류) → event_kind 역매핑. raw socket event 로 만든 toast 는 event_kind 가 없다.
const TYPE_FALLBACK_KIND: Record<string, string> = {
  message: 'message', task: 'task', invoice: 'invoice',
  signature: 'signature', event: 'event', system: 'system',
};

const MAX_VISIBLE = 3;
// 자동 페이드 제거 (2026-05-08 Irene 정책): X 버튼 / 클릭 이동 시만 닫힘. 사용자 인지 시간 보장.
export default function NotificationToaster() {
  const { user, switchWorkspace } = useAuth();
  const { t, i18n } = useTranslation('common');
  const location = useChromeLocation();
  const [toasts, setToasts] = useState<Toast[]>([]);
  // message:new 가 conv room + business room 양쪽으로 도착해 같은 메시지가 중복 토스트 되는 것 차단 (운영 #25)
  const seenMsgRef = useRef<Map<number, number>>(new Map());
  /** 이미 띄운 알림 행 id — 세션 내 재수신 차단 (2026-09-07 운영 5회 중복). */
  const seenNotifRef = useRef<Map<string, number>>(new Map());
  // #206 — task:updated payload 에 from_status 가 없어 "해제"를 판정할 수 없다.
  //   직전 상태를 클라가 기억해 전이 방향을 만든다 (세션 한정, 메모리만).
  const prevTaskStatusRef = useRef<Map<number, string>>(new Map());
  const activeConvIdRef = useRef<number | null>(null);
  const activePathRef = useRef<string>(location.pathname);

  // 사운드 unlock — 마운트 직후 첫 user gesture 리스너 등록.
  // socket 알림은 user gesture 가 아니라서 그 시점에 AudioContext 만들어도 Chrome 이 차단함.
  // 페이지에서 사용자가 한 번이라도 클릭/키 입력/터치하면 자동으로 unlock.
  useEffect(() => { ensureUnlock(); }, []);

  // 지금 떠 있는 카드 — sw.js 의 «이 알림 카드를 띄웠나» 물음에 답할 때 읽는다(state 는 리스너 클로저에서 낡는다).
  const toastsRef = useRef<Toast[]>([]);
  useEffect(() => { toastsRef.current = toasts; }, [toasts]);
  // 2026-10-21 «긴급 알림이 데스크탑앱에서 두 번» — 이 창을 보고 있고 같은 알림 카드를 띄워 두었으면
  //   sw.js 가 OS 알림을 생략한다(한 알림 = 한 번). 카드를 안 띄웠으면(끈 설정·같은 화면) false — OS 알림이 뜬다.
  useEffect(() => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (!sw) return;
    const onMsg = (e: MessageEvent) => {
      if (!e.data || e.data.type !== 'planq:push-shown-in-app?' || !e.ports?.[0]) return;
      const id = Number(e.data.notification_id);
      const looking = document.visibilityState === 'visible' && document.hasFocus();
      const shown = looking && !!id && toastsRef.current.some((x) => x.notificationId === id);
      e.ports[0].postMessage({ shown });
    };
    sw.addEventListener('message', onMsg);
    return () => sw.removeEventListener('message', onMsg);
  }, []);

  // 활성 컨텍스트 추적 — toast 가 같은 page/conv 에 떠 있으면 표시 X.
  // 사이클 N+15-D — URL 패턴 2종 모두 인식: /talk?conv=123 (쿼리), /talk/123 (path).
  // 옛 쿼리만 본 코드는 path-param 진입 직후 (URL 정규화 직전) 토스트 skip 실패.
  // 더 나아가, focus 상태(visibilitychange) 도 함께 본다 — 데스크탑 탭이 background 면 토스트 표시 OK.
  useEffect(() => {
    activePathRef.current = location.pathname;
    const params = new URLSearchParams(location.search);
    const queryConv = params.get('conv');
    if (queryConv) {
      activeConvIdRef.current = Number(queryConv);
      return;
    }
    // path-param /talk/:id 또는 /chat/:id
    const m = location.pathname.match(/^\/(?:talk|chat)\/(\d+)/);
    activeConvIdRef.current = m ? Number(m[1]) : null;
  }, [location.pathname, location.search]);

  const dismiss = useCallback((id: string) => {
    // N+73 — 닫기 시 DB Notification mark-read 호출. 좌측 BellDropdown 즉시 동기화.
    setToasts(prev => {
      const target = prev.find(x => x.id === id);
      if (target?.notificationId) {
        apiFetch(`/api/notifications/${target.notificationId}/read`, { method: 'PATCH' }).catch(() => null);
        // 옵티미스틱 — 좌측 종 unread 즉시 -1 (socket notification:read 도 보강)
        window.dispatchEvent(new CustomEvent('notification:refresh'));
      }
      return prev.filter(x => x.id !== id);
    });
  }, []);

  // 사이클 N+16-C — 알림 매트릭스 prefs 캐시 (chat channel 검사용).
  // 옛 toaster 는 주석에만 "chat channel ON 일 때만 표시" 라고 적고 실제 코드 검사 안 함 — 회귀 fix.
  // 마운트 시 + 'planq:notif-prefs-changed' 시 fetch. 5분 캐시.
  const prefsRef = useRef<{ matrix: Record<string, Record<string, boolean>>; ts: number } | null>(null);
  const refreshPrefs = useCallback(async () => {
    if (!user) return;
    const bizId = user.business_id ? Number(user.business_id) : null;
    if (!bizId) return;
    try {
      const r = await apiFetch(`/api/notifications/prefs?business_id=${bizId}`);
      const j = await r.json();
      if (j.success && j.data?.matrix) {
        prefsRef.current = { matrix: j.data.matrix, ts: Date.now() };
      }
    } catch { /* fall back to default ON */ }
  }, [user]);
  useEffect(() => {
    refreshPrefs();
    const onChanged = () => refreshPrefs();
    window.addEventListener('planq:notif-prefs-changed', onChanged);
    return () => window.removeEventListener('planq:notif-prefs-changed', onChanged);
  }, [refreshPrefs]);

  // toast.type → event_kind 매핑. 'message' 토스트는 'message' 또는 'mention' 둘 다 가능 (backend 구분 X)
  // → 어느 하나라도 chat=ON 이면 표시. 사용자가 두 토글 모두 끄면 모든 chat 토스터 차단.
  const isChatChannelAllowed = (toastType: string): boolean => {
    const matrix = prefsRef.current?.matrix;
    if (!matrix) return true; // prefs 미로딩 → 기본 ON
    const check = (ev: string) => matrix[ev]?.chat !== false;
    if (toastType === 'message') return check('message') || check('mention');
    if (toastType === 'task') return check('task');
    if (toastType === 'invoice') return check('invoice') || check('tax_invoice');
    if (toastType === 'signature') return check('signature');
    if (toastType === 'event') return check('event');
    return true; // system / 알 수 없음 — 표시
  };

  const add = useCallback((toast: Omit<Toast, 'id' | 'ts'>) => {
    // ★ 2026-09-07 (Irene, 운영 PWA: "검토 요청-K-DINE 오픈 준비리스트 알림이 5번 넘게
    //   우측 상단에 떴어") — DB 에는 그 알림이 **한 행뿐**이었다(운영 실측). 즉 같은 알림이
    //   여러 번 **수신**된 것이다(소켓 재연결·이벤트 소스 중복).
    //   아래의 dedup 은 ①화면에 남아 있는 토스트와만 비교하고 ②5초 창이라, 재연결 간격이
    //   그보다 길면 매번 새 토스트가 된다. 알림 행 id 는 **그 사건의 유일한 이름**이므로,
    //   id 가 있는 건 세션 내 한 번만 띄운다(시간창 없음).
    //   ★ 채팅은 여기 걸지 않는다 — 같은 방에서 같은 내용("네")이 다시 올 수 있고, 그쪽은
    //     이미 message id 기준 seenMsgRef 가 담당한다.
    if (toast.notificationId != null) {
      const key = `n:${toast.notificationId}`;
      if (seenNotifRef.current.has(key)) return;
      seenNotifRef.current.set(key, Date.now());
      if (seenNotifRef.current.size > 500) {
        const cutoff = Date.now() - 6 * 60 * 60 * 1000;
        for (const [k, ts] of seenNotifRef.current) if (ts < cutoff) seenNotifRef.current.delete(k);
      }
    }
    // ★ Irene 정책 (2026-05-08): 사운드는 항상 울려야 함 — 새 메시지 인지.
    //   토스트는 활성 conv / 같은 페이지면 skip (이미 보고 있어서 시각 노이즈).
    //   사이클 N+16-C — 추가로 chat channel pref OFF 면 skip (전수조사 fix).
    let skipToast = false;
    // 다른 워크스페이스 알림은 «지금 보는 대화·화면» 과 같을 수 없다(id·경로가 이 워크스페이스 것이 아니다)
    if (!toast.foreignBusinessId && toast.contextKey?.startsWith('conv:')) {
      const cid = Number(toast.contextKey.slice(5));
      if (cid && cid === activeConvIdRef.current) skipToast = true;
    }
    if (!toast.foreignBusinessId && toast.link && activePathRef.current === toast.link.split('?')[0]) {
      if (!toast.link.includes('?')) skipToast = true;
    }
    // 사용자가 이 종류의 «앱 안 알림(chat 열)» 을 끈 것 — 토스트도 소리도 내지 않는다(2026-10-08 0-H).
    //   옛: 토스트만 막고 소리는 울려 «껐는데 소리가 난다» 였다. 끈 설정은 사용자의 뜻이다.
    const channelOff = !isChatChannelAllowed(toast.type);
    if (channelOff) skipToast = true;
    // Ping 사운드 — 활성 conv·같은 페이지여도 울린다(Irene 2026-05-08: 사운드는 새 메시지 인지).
    //   단 위의 «끈 설정» 만은 예외.
    if (!channelOff) playPing();
    // 사이드바 토탈 unread 갱신 트리거 — message 토스터는 활성 conv 외 다른 conv 의 새 메시지를
    // 의미하므로 useUnreadTotal 이 즉시 refetch 해야 사이드바 뱃지가 stale 되지 않음.
    if (toast.type === 'message') {
      window.dispatchEvent(new Event('planq:unread-changed'));
    }
    if (skipToast) return;

    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const next: Toast = { ...toast, id, ts: Date.now() };
    // 자동 페이드 제거: X 닫기 / 클릭 이동 시만 닫힘. MAX_VISIBLE 만 유지.
    //
    // 운영 #278 — "알림이 2개 왔는데 같은 알림이 따로 오는 거 아니야?"
    //   토스터에는 소스가 둘이다: ①raw socket event(task:*, message:new …) ②notification:new row.
    //
    // ★ 이 dedup 이 실제로 잡는 것 = **같은 payload 가 두 번 수신되는 경우**
    //   (소켓 재연결 시 같은 task:updated 재수신 등). 실측으로 확인된 형태다.
    // ★ 잡지 못하는 것 = **소스가 다른 같은 사건**. 두 소스의 제목이 구조적으로 다르기 때문이다
    //   (raw 는 프론트 t() 문구, notification:new 는 서버 제목 규약 `Q Task · …`).
    //   그 방향은 위쪽 notification:new 핸들러의 contextKey 병합이 담당하고,
    //   백엔드가 broadcast 를 notify 보다 먼저 emit 하므로 역전 빈도는 낮다.
    //   — 실효 범위를 넘겨 적지 말 것. 주석이 과대하면 다음 사람이 고쳐야 할 것을 안 고친다.
    //
    // ★ body 까지 비교한다 — 같은 방에서 연속으로 온 채팅 2통은 제목·contextKey 가 같고
    //   본문만 다르다. body 를 안 보면 진짜 두 번째 메시지가 조용히 삼켜진다.
    const DEDUP_MS = 5000;
    setToasts(prev => {
      if (next.contextKey) {
        const dup = prev.find(t => t.contextKey === next.contextKey
          && t.title === next.title
          && t.body === next.body
          && next.ts - t.ts < DEDUP_MS);
        if (dup) return prev;   // 동일 payload 재수신 — 버린다
      }
      return [...prev, next].slice(-MAX_VISIBLE);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global socket — user 가 로그인되어 있을 때만 연결
  useEffect(() => {
    if (!user) return;
    const bizId = user.business_id ? Number(user.business_id) : null;
    if (!bizId) return;
    // 공유 소켓 (services/socket). 워크스페이스 룸 + 참여 conversation 룸 join.
    //   join 은 공유 소켓이 reconnect 시 roomRefs 로 자동 재join.
    const joinedConvRooms: string[] = [];
    const isForeign = (b?: number | null) => b != null && Number(b) !== bizId;
    joinRoom(`business:${bizId}`);
    // 사용자가 참여한 모든 conversation 룸 — message:new 받기 위해
    apiFetch(`/api/conversations/${bizId}`).then(r => r.json()).then(j => {
      if (j.success && Array.isArray(j.data)) {
        j.data.forEach((c: { id: number }) => {
          const room = `conversation:${c.id}`;
          joinRoom(room);
          joinedConvRooms.push(room);
        });
      }
    }).catch(() => {});

    // (제거) server:build → UpdateBanner forwarding — 사이클 N+3 회귀로 시스템 제거됨

    // N+73 — backend notify() 가 emit 하는 full row notification:new. DB Notification.id 포함.
    //   옛 raw event (message:new / task:new / ...) 와 같이 listen → 같은 알림이 둘 다 도착 가능.
    //   → contextKey 또는 notificationId 로 dedup. notificationId 우선.
    //   장점: notification_id 가 있으면 닫기 시 mark-read 호출 가능 → 좌측 BellDropdown 즉시 동기화.
    const offNotif = onSocket('notification:new', (row: NotificationFullRow) => {
      // ★ 다른 워크스페이스 알림도 띄운다(이름 줄 + 누르면 전환) — 2026-10-23 Irene «데스크탑앱에는 안 왔어». 옛 Q7 은 여기서 버렸다.
      //   종 목록·숫자는 그대로 지금 워크스페이스 범위(CLAUDE.md 워크스페이스 계약 7). 플랫폼 공지(null)는 종전대로.
      const foreign = isForeign(row.business_id) ? Number(row.business_id) : undefined;
      // 배너 2번 방지: 채팅류는 message:new 가 토스트 담당 → 여기선 skip. 단 다른 워크스페이스 채팅은 그 방에 join 안 해 여기서만 뜬다.
      const chatKind = row.event_kind === 'message' || row.event_kind === 'mention' || row.event_kind === 'comment_mention';
      if (chatKind && !foreign) return;
      const link = notificationRowToToastLink(row);
      const typeMap: Record<string, Toast['type']> = {
        message: 'message', mention: 'message', comment_mention: 'message',
        task: 'task',
        invoice: 'invoice', tax_invoice: 'invoice',
        signature: 'signature',
        event: 'event',
      };
      const toastType = typeMap[row.event_kind] || 'system';
      // contextKey — 활성 페이지 매칭용 + 옛 raw event 와 dedup 키
      let contextKey: string | undefined;
      if (row.entity_type === 'conversation' && row.entity_id) contextKey = `conv:${row.entity_id}`;
      else if (row.entity_type === 'task' && row.entity_id) contextKey = `task:${row.entity_id}`;
      else if (row.entity_type === 'post' && row.entity_id) contextKey = `post:${row.entity_id}`;

      // setToasts functional update — stale closure 회피 + dedup + 신규 추가 단일 처리
      let didMatch = false;
      setToasts(prev => {
        // 1) 같은 notification_id 이미 있으면 skip
        if (prev.some(t => t.notificationId === row.id)) { didMatch = true; return prev; }
        // 2) 옛 raw event 로 만든 같은 contextKey toast 가 있으면 notificationId 채우기
        if (contextKey) {
          const idx = prev.findIndex(t => t.contextKey === contextKey && !t.notificationId);
          if (idx >= 0) {
            const updated = [...prev];
            // 긴급 요청이면 서버 제목·본문(«[긴급] …»)으로 갈아 끼운다 — raw 이벤트 문구에는 긴급이 없고,
            //   본문만 raw(따옴표 없는 제목)로 남기면 OS 알림·종 목록과 글자가 달라 «다른 알림» 으로 읽혔다(2026-10-21)
            updated[idx] = { ...updated[idx], notificationId: row.id, link, ...(row.urgent ? { urgent: true, title: row.title, body: row.body || updated[idx].body } : {}) };
            didMatch = true;
            return updated;
          }
        }
        return prev;
      });
      // setState 콜백 동기 실행 후 didMatch 검사 — 신규 toast 가 필요한 경우만 add (sound/skip 정책 적용)
      if (!didMatch) {
        add({
          type: toastType,
          kind: row.event_kind,
          title: row.title,
          body: row.body || undefined,
          link,
          contextKey,
          notificationId: row.id,
          urgent: !!row.urgent,
          ...(foreign ? {
            foreignBusinessId: foreign,
            workspaceName: (user.workspaces || []).find((w) => Number(w.business_id) === foreign)?.brand_name || undefined,
          } : {}),
        });
      }
    });

    // 채팅 메시지 — 본인이 보낸 건 제외 (sender_id !== userId)
    const offMsg = onSocket('message:new', (msg: { id: number; conversation_id: number; sender_id: number; content?: string; attachment_hint?: { kind: 'image' | 'file'; count: number }; sender?: { name?: string; display_name?: string | null } }) => {
      if (msg.sender_id === Number(user.id)) return;
      // 중복 차단 — 같은 메시지가 conv room + business room 양쪽으로 도착 (백엔드 2회 emit). msg.id 로 1회만 처리.
      if (msg.id) {
        const now = Date.now();
        const seen = seenMsgRef.current;
        if (seen.has(msg.id) && now - (seen.get(msg.id) as number) < 10000) return;
        seen.set(msg.id, now);
        if (seen.size > 200) { for (const [k, ts] of seen) { if (now - ts > 30000) seen.delete(k); } }
      }
      const senderName = msg.sender?.display_name || msg.sender?.name || t('toaster.someone', '누군가');
      const preview = (msg.content || '').replace(/<[^>]*>/g, '').slice(0, 60);
      add({
        type: 'message',
        title: t('toaster.newMessage', '{{sender}} 의 메시지', { sender: senderName, defaultValue: `${senderName} 의 메시지` }) as string,
        body: preview || chatAttachLine(t, msg.attachment_hint),
        link: `/talk?conv=${msg.conversation_id}`,
        contextKey: `conv:${msg.conversation_id}`,
      });
    });

    // 새 업무 — 본인이 만든/액션한 건 skip
    const offTaskNew = onSocket('task:new', (task: { id: number; title: string; business_id?: number | null; assignee_id?: number; created_by?: number; project_id?: number | null; actor_user_id?: number }) => {
      const me = Number(user.id); if (isForeign(task.business_id)) return;   // 다른 워크스페이스 업무는 notification:new 카드(이름 줄)가 맡는다
      // 본인 액션 (방금 자기가 만든 건) skip — actor 또는 created_by
      if (task.actor_user_id === me || task.created_by === me) return;
      // 나에게 배정된 업무
      if (task.assignee_id === me) {
        add({
          type: 'task',
          title: t('toaster.taskAssigned', '새 업무가 배정됐어요') as string,
          body: task.title,
          link: `/tasks?task=${task.id}`,
          contextKey: `task:${task.id}`,
        });
      }
    });

    // 업무 상태 변경 — 본인 액션 알림 자기에게 표시 차단 + 받는 사람 역할별 메시지 분기.
    // task:updated 는 business room 에 broadcast 되어 모든 멤버가 받음.
    // 핵심 룰:
    //   1. actor === me → skip (본인이 누른 액션을 본인 토스터에 띄우지 않음)
    //   2. 받는 사람이 어떤 역할인지에 따라 메시지 차별화 (요청자 vs 검토자 vs 담당자)
    const offTaskUpd = onSocket('task:updated', (task: {
      id: number; title: string; status?: string; business_id?: number | null;
      assignee_id?: number; created_by?: number;
      reviewer_user_ids?: number[]; actor_user_id?: number;
    }) => {
      const me = Number(user.id); if (isForeign(task.business_id)) return;
      // 직전 상태는 **본인 액션까지 포함해** 기록한다 — 아래 전이 판정(entered)의 기준선이다.
      const prevStatus = prevTaskStatusRef.current.get(task.id);
      if (task.status) prevTaskStatusRef.current.set(task.id, task.status);
      // 본인 액션 알림 차단 — Irene 의 가장 큰 불편
      if (task.actor_user_id === me) return;

      const isAssignee = task.assignee_id === me;
      const isRequester = task.created_by === me;
      const isReviewer = Array.isArray(task.reviewer_user_ids) && task.reviewer_user_ids.includes(me);

      const link = `/tasks?task=${task.id}`;
      const ctx = `task:${task.id}`;
      // ★ task:updated 는 **아무 필드나 바뀌어도** 온다(진행률·시간·순서 재정렬). 여태 아래 세 토스트는
      //   "지금 상태" 만 봐서, 컨펌 대기 중인 업무를 담당자가 진행률만 고쳐도 컨펌자에게
      //   "검토 요청 — 컨펌해 주세요" 가 **다시** 떴다(운영 2026-10-06 #339 — 서버 알림은 0건이었다).
      //   → 이 화면이 **전이를 직접 본 때만** 띄운다. 처음 보는 업무(직전 상태 모름)는 서버 알림
      //     (notification:new — 컨펌 요청·수정 요청·완료 모두 notify 가 있다)이 맡는다.
      const entered = (s: string) => task.status === s && prevStatus !== undefined && prevStatus !== s;

      if (entered('completed')) {
        // 받는 사람 역할에 따라 메시지 분기
        if (isRequester && !isAssignee) {
          add({
            type: 'task',
            title: t('toaster.taskCompletedRequester', '요청한 업무가 완료됐어요') as string,
            body: task.title, link, contextKey: ctx,
          });
        } else if (isReviewer && !isAssignee && !isRequester) {
          add({
            type: 'task',
            title: t('toaster.taskCompletedReviewer', '검토한 업무가 완료 처리됐어요') as string,
            body: task.title, link, contextKey: ctx,
          });
        }
        // 담당자 본인이거나 무관자는 skip
      }
      if (entered('reviewing')) {
        if (isReviewer) {
          add({
            type: 'task',
            title: t('toaster.taskReviewing', '검토 요청 — 컨펌해 주세요') as string,
            body: task.title, link, contextKey: ctx,
          });
        }
      }
      if (entered('revision_requested')) {
        // 담당자에게 — 검토자가 수정 요청한 케이스
        if (isAssignee) {
          add({
            type: 'task',
            title: t('toaster.taskRevisionRequested', '수정 요청이 들어왔어요') as string,
            body: task.title, link, contextKey: ctx,
          });
        }
      }
      // #206 보류 / 외부컨펌 / 해제 — 담당자·의뢰자에게. 백엔드 알림(DB·push)과 별개로
      //   화면을 보고 있는 사람에게 즉시 알린다(§16 실시간 반영).
      const cares = isAssignee || isRequester;
      if (cares) {
        if (entered('on_hold')) {
          add({
            type: 'task',
            title: t('toaster.taskOnHold', '업무가 보류되었습니다') as string,
            body: task.title, link, contextKey: ctx,
          });
        } else if (entered('external_review')) {
          add({
            type: 'task',
            title: t('toaster.taskExternalReview', '외부 컨펌 대기로 전환되었습니다') as string,
            body: task.title, link, contextKey: ctx,
          });
        } else if ((prevStatus === 'on_hold' || prevStatus === 'external_review')
          && task.status !== 'on_hold' && task.status !== 'external_review') {
          // 해제 — 직전 상태를 알아야 판정된다(payload 에 from_status 가 없으므로 클라가 기억한다)
          add({
            type: 'task',
            title: t('toaster.taskResumed', '보류가 해제되었습니다') as string,
            body: task.title, link, contextKey: ctx,
          });
        }
      }
    });

    // 인박스 새로고침 (인보이스/서명 등)
    const offInbox = onSocket('inbox:refresh', (data: { reason?: string }) => {
      // reason 별로 분기 가능 — 일단 단순 알림
      if (!data?.reason) return;
      const labels: Record<string, string> = {
        signature_created: t('toaster.signatureRequested', '서명 요청이 도착했습니다') as string,
        signature_signed: t('toaster.signatureSigned', '서명 완료') as string,
        invoice_status: t('toaster.invoiceUpdated', '청구서 상태 변경') as string,
        installment_paid: t('toaster.installmentPaid', '결제 입금 확인') as string,
      };
      const title = labels[data.reason];
      if (!title) return;
      add({
        type: data.reason.startsWith('signature') ? 'signature' : 'invoice',
        title,
        link: '/inbox',
      });
    });

    return () => {
      leaveRoom(`business:${bizId}`);
      joinedConvRooms.forEach((r) => leaveRoom(r));
      offNotif(); offMsg(); offTaskNew(); offTaskUpd(); offInbox();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.business_id, i18n.language]);

  if (toasts.length === 0) return null;

  return (
    <ToasterRoot aria-live="polite" aria-atomic="false">
      {toasts.length >= 2 && (
        <ClearAllBar>
          <ClearAllBtn
            type="button"
            onClick={() => setToasts([])}
          >{t('toaster.clearAll', '모두 닫기 ({{n}})', { n: toasts.length, defaultValue: `모두 닫기 (${toasts.length})` })}</ClearAllBtn>
        </ClearAllBar>
      )}
      {toasts.map(toast => (
        <ToastCard key={toast.id}
          $type={toast.type}
          $urgent={!!toast.urgent}
          data-urgent={toast.urgent ? '1' : undefined}
          onClick={() => {
            // N+73 — toast.link 가 항상 정확 (Toaster 자체 link OR notification:new full row OR resolveNotificationLink fallback)
            // ★ 하던 일 위에 얹히는 진입점은 새 탭 — 드롭다운·알림 페이지와 같은 규칙(2026-10-08 0-H).
            //   옛: navigate 로 보던 탭을 덮어써 쓰던 글을 잃었다. 미러 모드(폰)는 tabStore 가 종전대로 이동한다.
            const target = toast.link || '/notifications';
            dismiss(toast.id);  // dismiss 가 mark-read 까지 처리
            // 다른 워크스페이스 — 전환하고 연다(푸시·앱 알림과 같은 문). 전환 실패면 종전대로 연다.
            if (toast.foreignBusinessId) {
              const sep = target.includes('?') ? '&' : '?';
              void enterWorkspaceLink(`${target}${sep}${WS_PARAM}=${toast.foreignBusinessId}`, user, switchWorkspace)
                .then((reloading) => { if (!reloading) openNotificationTarget(target); });
              return;
            }
            openNotificationTarget(target);
          }}
          role="alert"
        >
          <ToastIcon $type={toast.type}>
            <NotificationTypeIcon kind={toast.kind || TYPE_FALLBACK_KIND[toast.type]} size={16} />
          </ToastIcon>
          <ToastBody>
            {toast.foreignBusinessId && (
              <ToastWorkspace data-testid="toast-workspace">
                {toast.workspaceName || t('toaster.otherWorkspace', '다른 워크스페이스')}
              </ToastWorkspace>
            )}
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.body && <ToastDesc>{toast.body}</ToastDesc>}
          </ToastBody>
          <ToastClose
            type="button"
            onClick={(e) => { e.stopPropagation(); dismiss(toast.id); }}
            aria-label={t('toaster.close', '닫기') as string}
          >×</ToastClose>
        </ToastCard>
      ))}
    </ToasterRoot>
  );
}

// ─────────────────────────────────────────────
// Styled — 우측 상단 고정, focus steal 안 함, hover 시 강조
const ToasterRoot = styled.div`
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 9000;  /* 모달(2000) 보다 위, 시스템 dialog(9999) 보다는 아래 */
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;  /* 컨테이너는 click pass-through, 자식만 catch */
  width: min(360px, calc(100vw - 32px));
`;

const ToastCard = styled.div<{ $type: string; $urgent?: boolean }>`
  pointer-events: auto;
  display: grid;
  grid-template-columns: 32px 1fr 28px;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-left: 3px solid ${p =>
    p.$type === 'message' ? '#14B8A6' :
    p.$type === 'task' ? '#0D9488' :
    p.$type === 'invoice' ? '#F59E0B' :
    p.$type === 'signature' ? '#14B8A6' :
    '#64748B'};
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  cursor: pointer;
  animation: slideIn 0.18s ease-out;
  /* 긴급 업무요청 — 빨간 띠·연한 빨강 바탕. 토스트는 원래 자동으로 안 사라진다(닫기·클릭만) */
  ${(p) => (p.$urgent ? 'border-color: #FECDD3; border-left: 4px solid #E11D48; background: #FFF1F2;' : '')}
  transition: transform 0.15s, box-shadow 0.15s;
  &:hover {
    transform: translateX(-2px);
    box-shadow: 0 6px 16px rgba(15, 23, 42, 0.12);
  }
  @keyframes slideIn {
    from { transform: translateX(20px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
`;

const ToastIcon = styled.div<{ $type: string }>`
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  background: ${p =>
    p.$type === 'message' ? '#F0FDFA' :
    p.$type === 'task' ? '#F0FDFA' :
    p.$type === 'invoice' ? '#FEF3C7' :
    p.$type === 'signature' ? '#F0FDFA' :
    '#F1F5F9'};
  color: ${p =>
    p.$type === 'message' ? '#0D9488' :
    p.$type === 'task' ? '#0D9488' :
    p.$type === 'invoice' ? '#92400E' :
    p.$type === 'signature' ? '#0F766E' :
    '#475569'};
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 700;
  flex-shrink: 0;
`;

const ToastBody = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ToastWorkspace = styled.div`
  font-size: 0.6875rem;
  font-weight: 600;
  color: #0F766E;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
`;

const ToastTitle = styled.div`
  font-size: 0.8125rem;
  font-weight: 600;
  color: #0F172A;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
`;

const ToastDesc = styled.div`
  font-size: 0.75rem;
  color: #64748B;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
`;

const ToastClose = styled.button`
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  font-size: 1.125rem;
  line-height: 1;
  color: #94A3B8;
  cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;

const ClearAllBar = styled.div`
  pointer-events: auto;
  display: flex;
  justify-content: flex-end;
  padding: 0 4px 4px 0;
`;

const ClearAllBtn = styled.button`
  background: rgba(15, 23, 42, 0.78);
  color: #FFFFFF;
  border: none;
  border-radius: 14px;
  padding: 4px 10px;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: -0.1px;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.18);
  transition: background 0.15s;
  &:hover { background: rgba(15, 23, 42, 0.92); }
`;
