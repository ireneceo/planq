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
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import { useNavigate, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { notificationRowToToastLink, type NotificationFullRow } from '../../utils/notificationLink';

interface Toast {
  id: string;
  type: 'message' | 'task' | 'invoice' | 'signature' | 'event' | 'system';
  title: string;
  body?: string;
  link?: string;            // 클릭 시 이동 (resolveNotificationLink 통과한 값)
  contextKey?: string;      // 활성 페이지 매칭용 (예: conv:123, task:45)
  notificationId?: number;  // N+73 — DB Notification.id (있으면 닫기/클릭 시 mark-read 호출)
  ts: number;
}

const MAX_VISIBLE = 3;
// 자동 페이드 제거 (2026-05-08 Irene 정책): X 버튼 / 클릭 이동 시만 닫힘. 사용자 인지 시간 보장.
// mp3 음원 우선, 실패 시 Web Audio 합성 fallback. 음원은 public/sounds/notification.mp3 (없으면 합성 사용).
const PING_MP3 = '/sounds/notification.mp3';

// 짧은 ping 사운드 — Web Audio API. 외부 mp3 파일 의존성 X.
//
// Chrome autoplay 정책: AudioContext 는 사용자 gesture 안에서 만들어야 작동. socket 이벤트는
// gesture 가 아님 → 이벤트 시점에 ctx 새로 만들면 suspended 채로 영구히 무음.
//
// 해결:
//   1) 페이지 첫 user-gesture (click/keydown/touchstart) 시점에 단일 AudioContext 생성 + resume.
//   2) 이후 ping 은 그 ctx 를 재사용 — Chrome 한도(동시 6개) 초과 위험 제거 + suspended race 제거.
//   3) Safari/iOS 도 같은 정책. webkit prefix 폴백 유지.
type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };
let unlockedCtx: AudioContext | null = null;
let unlockTried = false;
function ensureUnlock() {
  if (unlockTried) return;
  unlockTried = true;
  const tryUnlock = () => {
    try {
      const Ctx = window.AudioContext || (window as WindowWithWebkit).webkitAudioContext;
      if (!Ctx) return;
      if (!unlockedCtx) unlockedCtx = new Ctx();
      // 이 ensureUnlock 자체가 user gesture handler 안에서 호출됨 → resume 가 정상 처리됨
      if (unlockedCtx.state === 'suspended') {
        unlockedCtx.resume().catch(() => null);
      }
    } catch { /* silent */ }
  };
  // gesture 종류 어떤 거든 한 번이면 됨 — 핸들러 자체에서 unlock 시도
  const handler = () => {
    tryUnlock();
    window.removeEventListener('click', handler);
    window.removeEventListener('keydown', handler);
    window.removeEventListener('touchstart', handler);
  };
  window.addEventListener('click', handler, { once: true });
  window.addEventListener('keydown', handler, { once: true });
  window.addEventListener('touchstart', handler, { once: true });
}

// mp3 캐시 — null = 미시도, HTMLAudioElement = 사용 가능, mp3Failed=true 면 합성으로 영구 전환
let mp3El: HTMLAudioElement | null = null;
let mp3Failed = false;
// debounce — 200ms 이내 중복 ping skip (짧은 간격에 여러 알림 도착 시 사운드 중첩 방지)
let lastPingAt = 0;

function playPing() {
  const now = Date.now();
  if (now - lastPingAt < 200) return;
  lastPingAt = now;
  if (!mp3Failed) {
    if (!mp3El) {
      try {
        const a = new Audio(PING_MP3);
        a.volume = 0.7;
        a.preload = 'auto';
        mp3El = a;
      } catch { mp3Failed = true; }
    }
    const el = mp3El;
    if (el && !mp3Failed) {
      try {
        el.currentTime = 0;
        const p = el.play();
        if (p && typeof p.then === 'function') {
          p.then(() => { /* OK */ }).catch(() => {
            // 404 / 자동재생 차단 / 디코딩 실패 — 합성으로 영구 전환
            mp3Failed = true;
            playSynth();
          });
        }
        return;
      } catch { mp3Failed = true; }
    }
  }
  playSynth();
}

// Web Audio 합성 — 부드러운 2음 차임 (C5 523Hz + E5 659Hz, major third).
// 옛 버전(G5 784Hz + D6 1174Hz, gain 0.45, lowpass 없음)은 맥북 스피커가 고역을 날카롭게
// 재생해 "귀아픔" 호소(운영). 모바일은 고역 roll-off 라 원래 부드러웠음.
// → 저역대(<700Hz)로 낮춤 + lowpass 2kHz 로 날카로운 고역 제거 + 볼륨 0.45→0.16 으로 톤다운.
function playSynth() {
  try {
    if (!unlockedCtx || unlockedCtx.state === 'closed') {
      const Ctx = window.AudioContext || (window as WindowWithWebkit).webkitAudioContext;
      if (!Ctx) return;
      unlockedCtx = new Ctx();
    }
    const ctx = unlockedCtx;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => null);
      return;
    }
    const now = ctx.currentTime;

    // lowpass — 날카로운 고역 차단 (귀 통증의 핵심 원인). 2kHz 위 부드럽게 감쇠.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2000, now);
    lp.Q.setValueAtTime(0.7, now);

    const master = ctx.createGain();
    lp.connect(master);
    master.connect(ctx.destination);
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.16, now + 0.02);   // 0.45 → 0.16 (부드럽게)
    master.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    // Fundamental — C5 (따뜻한 중역)
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, now);
    osc1.connect(lp);
    osc1.start(now);
    osc1.stop(now + 0.65);

    // 화음 — E5 (장3도 위), 50ms 늦게 + 낮은 게인 → 날카롭지 않은 따뜻한 차임
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(659.25, now + 0.05);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.35, now);
    osc2.connect(g2); g2.connect(lp);
    osc2.start(now + 0.05);
    osc2.stop(now + 0.65);
  } catch { /* silent */ }
}

export default function NotificationToaster() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation('common');
  const navigate = useChromeNav();
  const location = useChromeLocation();
  const [toasts, setToasts] = useState<Toast[]>([]);
  // message:new 가 conv room + business room 양쪽으로 도착해 같은 메시지가 중복 토스트 되는 것 차단 (운영 #25)
  const seenMsgRef = useRef<Map<number, number>>(new Map());
  const activeConvIdRef = useRef<number | null>(null);
  const activePathRef = useRef<string>(location.pathname);

  // 사운드 unlock — 마운트 직후 첫 user gesture 리스너 등록.
  // socket 알림은 user gesture 가 아니라서 그 시점에 AudioContext 만들어도 Chrome 이 차단함.
  // 페이지에서 사용자가 한 번이라도 클릭/키 입력/터치하면 자동으로 unlock.
  useEffect(() => { ensureUnlock(); }, []);

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
    // ★ Irene 정책 (2026-05-08): 사운드는 항상 울려야 함 — 새 메시지 인지.
    //   토스트는 활성 conv / 같은 페이지면 skip (이미 보고 있어서 시각 노이즈).
    //   사이클 N+16-C — 추가로 chat channel pref OFF 면 skip (전수조사 fix).
    let skipToast = false;
    if (toast.contextKey?.startsWith('conv:')) {
      const cid = Number(toast.contextKey.slice(5));
      if (cid && cid === activeConvIdRef.current) skipToast = true;
    }
    if (toast.link && activePathRef.current === toast.link.split('?')[0]) {
      if (!toast.link.includes('?')) skipToast = true;
    }
    if (!isChatChannelAllowed(toast.type)) skipToast = true;
    // Ping 사운드 — 항상. 활성 conv 든 다른 페이지든. (Irene 명시: 사운드 와야 함)
    playPing();
    // 사이드바 토탈 unread 갱신 트리거 — message 토스터는 활성 conv 외 다른 conv 의 새 메시지를
    // 의미하므로 useUnreadTotal 이 즉시 refetch 해야 사이드바 뱃지가 stale 되지 않음.
    if (toast.type === 'message') {
      window.dispatchEvent(new Event('planq:unread-changed'));
    }
    if (skipToast) return;

    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const next: Toast = { ...toast, id, ts: Date.now() };
    // 자동 페이드 제거: X 닫기 / 클릭 이동 시만 닫힘. MAX_VISIBLE 만 유지.
    setToasts(prev => [...prev, next].slice(-MAX_VISIBLE));
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
      // 배너 2번 방지: 채팅류(message/mention)는 message:new(socket) 가 토스트 담당.
      //   notification:new 까지 토스트하면 같은 채팅이 2번 뜸 → 여기선 채팅류 skip (비채팅만 토스트).
      if (row.event_kind === 'message' || row.event_kind === 'mention' || row.event_kind === 'comment_mention') return;
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
            updated[idx] = { ...updated[idx], notificationId: row.id, link };
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
          title: row.title,
          body: row.body || undefined,
          link,
          contextKey,
          notificationId: row.id,
        });
      }
    });

    // 채팅 메시지 — 본인이 보낸 건 제외 (sender_id !== userId)
    const offMsg = onSocket('message:new', (msg: { id: number; conversation_id: number; sender_id: number; content?: string; sender?: { name?: string; display_name?: string | null } }) => {
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
        body: preview || (t('toaster.attachmentOnly', '(첨부파일)') as string),
        link: `/talk?conv=${msg.conversation_id}`,
        contextKey: `conv:${msg.conversation_id}`,
      });
    });

    // 새 업무 — 본인이 만든/액션한 건 skip
    const offTaskNew = onSocket('task:new', (task: { id: number; title: string; assignee_id?: number; created_by?: number; project_id?: number | null; actor_user_id?: number }) => {
      const me = Number(user.id);
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
      id: number; title: string; status?: string;
      assignee_id?: number; created_by?: number;
      reviewer_user_ids?: number[]; actor_user_id?: number;
    }) => {
      const me = Number(user.id);
      // 본인 액션 알림 차단 — Irene 의 가장 큰 불편
      if (task.actor_user_id === me) return;

      const isAssignee = task.assignee_id === me;
      const isRequester = task.created_by === me;
      const isReviewer = Array.isArray(task.reviewer_user_ids) && task.reviewer_user_ids.includes(me);

      const link = `/tasks?task=${task.id}`;
      const ctx = `task:${task.id}`;

      if (task.status === 'completed') {
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
      if (task.status === 'reviewing') {
        if (isReviewer) {
          add({
            type: 'task',
            title: t('toaster.taskReviewing', '검토 요청 — 컨펌해 주세요') as string,
            body: task.title, link, contextKey: ctx,
          });
        }
      }
      if (task.status === 'revision_requested') {
        // 담당자에게 — 검토자가 수정 요청한 케이스
        if (isAssignee) {
          add({
            type: 'task',
            title: t('toaster.taskRevisionRequested', '수정 요청이 들어왔어요') as string,
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
          onClick={() => {
            // N+73 — toast.link 가 항상 정확 (Toaster 자체 link OR notification:new full row OR resolveNotificationLink fallback)
            navigate(toast.link || '/notifications');
            dismiss(toast.id);  // dismiss 가 mark-read 까지 처리
          }}
          role="alert"
        >
          <ToastIcon $type={toast.type}>
            {toast.type === 'message' && '💬'}
            {toast.type === 'task' && '✓'}
            {toast.type === 'invoice' && '$'}
            {toast.type === 'signature' && '✎'}
            {toast.type === 'event' && '📅'}
            {toast.type === 'system' && 'i'}
          </ToastIcon>
          <ToastBody>
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

const ToastCard = styled.div<{ $type: string }>`
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
  font-size: 14px;
  font-weight: 700;
  flex-shrink: 0;
`;

const ToastBody = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ToastTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: #0F172A;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
`;

const ToastDesc = styled.div`
  font-size: 12px;
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
  font-size: 18px;
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
  font-size: 11px;
  font-weight: 600;
  letter-spacing: -0.1px;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.18);
  transition: background 0.15s;
  &:hover { background: rgba(15, 23, 42, 0.92); }
`;
