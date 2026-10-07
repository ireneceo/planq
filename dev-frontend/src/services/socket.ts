// 공유 소켓 서비스 (멀티탭 keep-alive P0-A) — docs/MULTITAB_DESIGN.md §2.1
//
// 문제(기존): 24개 파일이 각자 io() 소켓을 생성 → 멀티탭 keep-alive 시 탭당 소켓이 쌓여
//   소켓 폭발 + 브로드캐스트 N벌 중복 수신 + 재연결 폭주.
// 해결: 세션당 소켓 1개. 페이지/훅은 room 구독(joinRoom)과 이벤트 리스너(onSocket)만 한다.
//   room 은 refCount — 마지막 구독자가 떠날 때만 서버에 leave emit (다른 탭이 쓰는 room 유지).
//
// 규약:
//   room 문자열 = `${kind}:${id}` — 서버 핸들러가 있는 kind 만: 'business', 'conversation', 'project'
//     (server.js join:business / join:conversation / join:project). 그 외 kind 는 서버 no-op.
//   서버는 connection 시 autoJoinUserBusinesses 로 전 워크스페이스 room 자동 join(근본 fix)이므로
//     client joinRoom('business:*') 은 이중 보장(멱등). 재연결 시 connect 핸들러가 활성 room 전부 재join.
//   직접 io() 호출 금지 — 반드시 이 모듈 경유.
//
// ⚠ 인증 계약 (Fable 검수 반영): 소켓은 access token 이 있을 때만 생성된다(미인증 재연결 스톰 차단).
//   미인증 시 joinRoom/onSocket 호출은 의도를 버퍼링만 하고, 로그인 후 최초 인증 호출 시점에
//   소켓 생성 + 버퍼된 room/listener 를 일괄 부착. getAccessToken() 은 AuthContext 모듈 변수.
import { io, type Socket } from 'socket.io-client';
import { getAccessToken, apiFetch } from '../contexts/AuthContext';

let socket: Socket | null = null;
const roomRefs = new Map<string, number>();          // room -> 활성 구독자 수
const listeners = new Set<{ event: string; handler: (...a: unknown[]) => void }>(); // 버퍼(재부착용)

function emitRoom(action: 'join' | 'leave', room: string): void {
  if (!socket) return;
  const idx = room.indexOf(':');
  if (idx < 0) return;
  const kind = room.slice(0, idx);
  const raw = room.slice(idx + 1);
  const id = /^\d+$/.test(raw) ? Number(raw) : raw;
  socket.emit(`${action}:${kind}`, id);
}

// 토큰이 있을 때만 소켓 생성. 없으면 null 반환(생성 defer) — 미인증 재연결 스톰 차단.
function ensureSocket(): Socket | null {
  if (socket) return socket;
  if (!getAccessToken()) return null;
  // auth 를 함수로 — 매 재연결마다 최신 토큰 사용 (refresh 후 자동 적용).
  const s = io(window.location.origin, {
    auth: (cb: (data: object) => void) => cb({ token: getAccessToken() }),
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 8000,
    reconnectionAttempts: Infinity,
  });
  // 토큰 만료 connect_error → access token 갱신 후 자동 재시도 (24곳 중복 로직 1곳 통합).
  //   apiFetch('/api/auth/me') 가 401 받으면 AuthContext 가 refresh + getAccessToken 갱신.
  //
  // ★ 2026-10-01 (Irene: "메일리스트에 메일이 실시간으로 안들어와") — **서버가 거절한 연결은
  //   socket.io 가 다시 시도하지 않는다**(v4: 미들웨어 거절 = `active:false`, 자동 재연결 중단).
  //   화면을 15분 넘게 열어 두면 access token 이 만료돼 있다. 그 상태에서 서버 재시작(배포)·
  //   네트워크 끊김이 한 번이라도 나면 재연결이 거절되고, 토큰을 갱신해도 소켓은 **영영 죽은 채**
  //   남았다 — 창이 계속 보이는 데스크탑은 visibility 복귀도 없어 새로고침 전까지 실시간 0.
  //   실측(node 클라이언트): 만료 토큰 1회 거절 → 토큰 갱신 후 6초 동안 재시도 0회.
  //   → 토큰을 갱신한 뒤 **직접 connect()** 한다. 로그아웃 상태(토큰 없음)면 붙지 않는다.
  //     갱신이 계속 실패하는 경우를 위해 지연을 늘려 간다(재연결 폭주 차단).
  let authRetryDelay = 1500;
  s.on('connect_error', async (err: Error) => {
    const msg = String(err?.message || '');
    if (/auth|token|jwt|unauthorized/i.test(msg)) {
      await apiFetch('/api/auth/me').catch(() => null);
    }
    if (s.active) return;                    // socket.io 가 스스로 재시도 중이다
    const delay = authRetryDelay;
    authRetryDelay = Math.min(authRetryDelay * 2, 60_000);
    window.setTimeout(() => {
      if (socket !== s || s.connected || s.active) return;   // 로그아웃·이미 붙음
      if (!getAccessToken()) return;
      s.connect();
    }, delay);
  });
  // 최초 connect + 재연결 시 활성 room 전부 재join (서버 auto-join 과 이중 보장, 멱등).
  let everConnected = false;
  s.on('connect', () => {
    authRetryDelay = 1500;
    roomRefs.forEach((count, room) => {
      if (count > 0) emitRoom('join', room);
    });
    // 끊겨 있던 동안의 broadcast 는 다시 오지 않는다 — 화면이 서버 상태를 다시 읽게 알린다.
    lastViewing = '';
    sendViewing(true);
    if (everConnected) window.dispatchEvent(new CustomEvent('socket:reconnected'));
    everConnected = true;
  });
  // 미인증 시점에 버퍼된 리스너 일괄 부착 (연결 전에 부착돼야 첫 이벤트 유실 없음).
  listeners.forEach(({ event, handler }) => s.on(event, handler));
  socket = s;
  return s;
}

/** 세션 공유 소켓 반환(토큰 없으면 null). 대부분은 joinRoom/onSocket 사용. */
export function getSocket(): Socket | null {
  return ensureSocket();
}

/** room 구독 시작. 최초 구독자(0→1)일 때만 서버에 join emit. 미인증이면 connect 시 join. */
export function joinRoom(room: string): void {
  const next = (roomRefs.get(room) || 0) + 1;
  roomRefs.set(room, next);
  const s = ensureSocket();
  if (next === 1 && s?.connected) emitRoom('join', room);
  // 미연결/미인증이면 connect 핸들러가 join 담당.
}

/** room 구독 해제. 마지막 구독자(1→0)일 때만 서버에 leave emit. */
export function leaveRoom(room: string): void {
  const cur = roomRefs.get(room) || 0;
  if (cur <= 1) {
    roomRefs.delete(room);
    if (socket?.connected) emitRoom('leave', room);
  } else {
    roomRefs.set(room, cur - 1);
  }
}

/** 이벤트 리스너 등록. 반환 함수로 해제. 미인증이면 버퍼링 후 소켓 생성 시 자동 부착. */
export function onSocket<T = unknown>(event: string, handler: (data: T) => void): () => void {
  const rec = { event, handler: handler as (...a: unknown[]) => void };
  listeners.add(rec);
  const s = ensureSocket();
  if (s) s.on(event, rec.handler);
  return () => {
    listeners.delete(rec);
    if (socket) socket.off(event, rec.handler);
  };
}

// ── 지금 보고 있는 대화방 (presence) ───────────────────────────────────────
// 같은 사람의 다른 기기에서 이 방을 **보고 있으면** 서버가 채팅 푸시를 생략한다(services/presence.js).
//   화면은 registerViewing 으로 «이 방을 그리고 있다» 를 등록하고, 실제로 보이는지는 등록한 쪽이 판정한다
//   (keep-alive 로 숨은 탭·문서 hidden 은 보이지 않는 것이다). 30초마다 + 바뀔 때 보낸다 — 서버는 90초가 지나면 잊는다.
const viewers = new Map<symbol, { convId: number; visible: () => boolean }>();
let viewingTimer: number | null = null;
let lastViewing = '';
// 마지막 사람 손길 — 열어만 두고 자리를 비운 데스크탑이 폰 푸시를 삼키면 안 된다(Fable 행 15: «보이고 + 최근 입력»).
let lastActivity = Date.now();
const IDLE_MS = 90_000;

function currentViewing(): number[] {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return [];
  if (Date.now() - lastActivity > IDLE_MS) return [];
  const ids = new Set<number>();
  viewers.forEach((v) => { try { if (v.visible()) ids.add(v.convId); } catch { /* 판정 실패 = 안 보임 */ } });
  return [...ids].sort((a, b) => a - b);
}

function sendViewing(force = false): void {
  const s = socket;
  if (!s?.connected) return;
  const ids = currentViewing();
  const key = ids.join(',');
  if (!force && key === lastViewing) return;
  lastViewing = key;
  s.emit('presence:viewing', { ids });
}

function ensureViewingLoop(): void {
  if (viewingTimer != null || typeof window === 'undefined') return;
  viewingTimer = window.setInterval(() => sendViewing(true), 30_000);   // 서버 기준 90초 — 30초 간격이면 두 번 놓쳐도 이어진다
  // 바뀐 때만 보낸다(sendViewing 비강제) — 탭 전환으로 보이는 방이 바뀐 것도 다음 손길에 실린다.
  const touch = () => { lastActivity = Date.now(); sendViewing(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') lastActivity = Date.now(); sendViewing(true); });
  window.addEventListener('focus', () => { lastActivity = Date.now(); sendViewing(true); });
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
    window.addEventListener(ev, touch, { passive: true, capture: true });
  }
}

/** 대화방을 화면에 그리는 동안 등록. visible() 이 거짓이면(숨은 탭 등) 보고 있지 않은 것으로 친다. 반환 함수로 해제. */
export function registerViewing(convId: number, visible: () => boolean): () => void {
  const key = Symbol('viewing');
  viewers.set(key, { convId, visible });
  ensureViewingLoop();
  ensureSocket();
  sendViewing(true);
  // 막 그려진 직후엔 상자가 아직 배치 전이라 «안 보임» 으로 나간다 — 배치가 끝난 뒤 한 번 더(바뀐 때만 나간다).
  window.setTimeout(() => sendViewing(), 800);
  return () => { viewers.delete(key); sendViewing(true); };
}

/** 등록한 화면의 보임 여부가 바뀌었을 때(탭 전환 등) 즉시 다시 보낸다. */
export function refreshViewing(): void { sendViewing(); }

/** 로그아웃 시 호출 — 세션 소켓 완전 정리. 리스너 버퍼는 각 구독자 cleanup 이 비운다. */
export function teardownSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  roomRefs.clear();
}
