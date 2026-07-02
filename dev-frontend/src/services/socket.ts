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
  s.on('connect_error', async (err: Error) => {
    const msg = String(err?.message || '');
    if (/auth|token|jwt|unauthorized/i.test(msg)) {
      await apiFetch('/api/auth/me').catch(() => null);
    }
  });
  // 최초 connect + 재연결 시 활성 room 전부 재join (서버 auto-join 과 이중 보장, 멱등).
  s.on('connect', () => {
    roomRefs.forEach((count, room) => {
      if (count > 0) emitRoom('join', room);
    });
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

/** 로그아웃 시 호출 — 세션 소켓 완전 정리. 리스너 버퍼는 각 구독자 cleanup 이 비운다. */
export function teardownSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  roomRefs.clear();
}
