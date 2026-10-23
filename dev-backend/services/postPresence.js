// 문서 «누가 같이 쓰고 있나» (2026-10-22 · docs/DOC_COEDIT_DESIGN.md B 안 · Fable 방향 판정)
//
// 2026-08-25 첫 판(server.js 안 인라인)을 옮겨 고친 것이다. 고친 점:
//   ① 이름을 화면이 보내던 것을 서버가 정한다 — 남의 이름으로 «편집 중» 을 띄울 수 있었다.
//   ② 들어올 수 있는 사람 = 그 문서를 **고칠 수 있는** 워크스페이스 멤버(canEditPost) — 예전엔 멤버이기만 하면
//      남의 «나만 보기» 문서에서 누가 쓰는지 엿볼 수 있었다. 고객은 멤버가 아니라 처음부터 못 들어온다.
//   ③ 소켓(창)마다 센다 — 같은 사람이 창 둘을 열고 하나를 닫으면 «편집 중» 이 통째로 사라졌다.
//   ④ 보기만 하는 사람도 방에 들어온다(목록에는 안 나온다) — 보기 화면에서도 «○○ 편집 중» 을 알아야
//      [편집] 을 누르기 전에 안다.
//   ⑤ «지금 치고 있다» = 최근 30초 안에 입력 — 편집기를 열어 두고 자리를 뜬 사람 때문에 겁먹지 않게.
//
// 상태는 메모리에만 둔다(프로세스가 죽으면 비는 게 맞다). 단일 프로세스 전제 — services/presence.js 와 같다.
'use strict';

const TYPING_FRESH_MS = 30 * 1000;
const RECHECK_MS = 60 * 1000;   // 입력 신호가 올 때 권한을 다시 보는 간격

// postId → Map<socketId, { userId, name, editing, typedAt, checkedAt }>
const rooms = new Map();
const roomName = (postId) => `postedit:${postId}`;

function snapshot(postId, now = Date.now()) {
  const room = rooms.get(postId);
  if (!room) return [];
  // 한 사람이 창 여럿이면 한 줄로 — 편집 중인 창이 하나라도 있으면 편집 중, 입력은 가장 최근 것.
  const byUser = new Map();
  for (const e of room.values()) {
    if (!e.editing) continue;
    const cur = byUser.get(e.userId);
    const typedAt = Math.max(cur ? cur.typedAt : 0, e.typedAt || 0);
    byUser.set(e.userId, { userId: e.userId, name: e.name, typedAt });
  }
  return [...byUser.values()].map((u) => ({
    userId: u.userId, name: u.name, typing: !!u.typedAt && now - u.typedAt < TYPING_FRESH_MS,
  }));
}

function broadcast(io, postId) {
  if (!io) return;
  io.to(roomName(postId)).emit('post:presence', { post_id: postId, users: snapshot(postId) });
}

// 들어와도 되는가 — 워크스페이스 현직 멤버 ∧ 문서가 그 워크스페이스 것 ∧ 고칠 수 있다(canEditPost).
//   돌려주는 값은 표시 이름(워크스페이스 표시명 → 계정 이름). 안 되면 null.
async function authorize(userId, postId, businessId) {
  const { Post, BusinessMember, Business, User } = require('../models');
  const alive = await Business.findOne({ where: { id: businessId, deleted_at: null }, attributes: ['id'] });
  if (!alive) return null;
  const bm = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: userId, removed_at: null },
    attributes: ['id', 'name'],
  });
  if (!bm) return null;
  const post = await Post.findOne({ where: { id: postId, business_id: businessId } });
  if (!post) return null;
  const { canEditPost } = require('../routes/posts');
  if (!(await canEditPost(userId, post, null))) return null;
  let name = bm.name;
  if (!name) {
    const u = await User.findByPk(userId, { attributes: ['name'] });
    name = u?.name || '';
  }
  return String(name || '').slice(0, 40);
}

async function join(io, socket, postId, businessId, editing) {
  const name = await authorize(socket.userId, postId, businessId);
  if (name === null) {
    // 같은 워크스페이스로 다시 물었는데 안 되면 권한이 줄어든 것 — 뺀다. 엉뚱한 워크스페이스 id 는 무시만 한다
    //   (그걸로 이미 들어와 있던 정당한 자리를 지우지 않는다).
    const cur = rooms.get(postId)?.get(socket.id);
    if (cur && cur.businessId === Number(businessId)) leave(io, socket, postId);
    return false;
  }
  socket.join(roomName(postId));
  const room = rooms.get(postId) || new Map();
  const prev = room.get(socket.id);
  room.set(socket.id, {
    userId: socket.userId, name, businessId, editing: !!editing,
    typedAt: editing && prev ? prev.typedAt : 0, checkedAt: Date.now(),
  });
  rooms.set(postId, room);
  socket.data = socket.data || {};
  socket.data.presencePosts = socket.data.presencePosts || new Set();
  socket.data.presencePosts.add(postId);
  broadcast(io, postId);
  return true;
}

// 입력 신호 — 화면이 10초에 한 번까지만 보낸다. 상태가 «편집 중» 으로 바뀌는 순간과 30초가 지나는 순간만
//   방에 다시 알린다(매 신호마다 뿌리지 않는다).
async function typing(io, socket, postId) {
  const room = rooms.get(postId);
  const e = room && room.get(socket.id);
  if (!e || !e.editing) return;
  const now = Date.now();
  if (now - e.checkedAt > RECHECK_MS) {
    const name = await authorize(socket.userId, postId, e.businessId);
    if (name === null) { leave(io, socket, postId); return; }
    e.checkedAt = now;
  }
  const wasTyping = e.typedAt && now - e.typedAt < TYPING_FRESH_MS;
  e.typedAt = now;
  if (!wasTyping) broadcast(io, postId);
  // 30초 뒤 «치는 중» 이 꺼지는 것도 알린다 — 새 신호가 왔으면 그때 다시 잡힌다.
  clearTimeout(e.cool);
  e.cool = setTimeout(() => {
    const cur = rooms.get(postId)?.get(socket.id);
    if (cur && Date.now() - cur.typedAt >= TYPING_FRESH_MS) broadcast(io, postId);
  }, TYPING_FRESH_MS + 200);
}

function leave(io, socket, postId) {
  const room = rooms.get(postId);
  if (room) {
    const e = room.get(socket.id);
    if (e) clearTimeout(e.cool);
    room.delete(socket.id);
    if (room.size === 0) rooms.delete(postId);
  }
  socket.leave(roomName(postId));
  if (socket.data?.presencePosts) socket.data.presencePosts.delete(postId);
  broadcast(io, postId);
}

function leaveAll(io, socket) {
  for (const pid of [...(socket.data?.presencePosts || [])]) leave(io, socket, pid);
}

// 워크스페이스에서 내보낸 사람 — 그 워크스페이스 문서 방에서 전부 뺀다(services/socketRevoke 가 부른다).
async function dropUserFromBusiness(io, userId, businessId) {
  if (!io) return;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  const ids = new Set(sockets.map((s) => s.id));
  for (const [postId, room] of [...rooms]) {
    let changed = false;
    for (const [sid, e] of [...room]) {
      if (e.userId === Number(userId) && e.businessId === Number(businessId)) {
        clearTimeout(e.cool);
        room.delete(sid);
        changed = true;
        if (ids.has(sid)) {
          const s = sockets.find((x) => x.id === sid);
          if (s) s.leave(roomName(postId));
        }
      }
    }
    if (room.size === 0) rooms.delete(postId);
    if (changed) broadcast(io, postId);
  }
}

// 공동 편집자에서 뺀 사람 — 그 문서 방에서 뺀다(services/postEditors.remove 가 부른다). PUT 은 어차피 403 이다.
async function dropUserFromPost(io, userId, postId) {
  if (!io) return;
  const room = rooms.get(Number(postId));
  if (!room) return;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  let changed = false;
  for (const [sid, e] of [...room]) {
    if (e.userId !== Number(userId)) continue;
    clearTimeout(e.cool);
    room.delete(sid);
    changed = true;
    const s = sockets.find((x) => x.id === sid);
    if (s) { s.leave(roomName(Number(postId))); if (s.data?.presencePosts) s.data.presencePosts.delete(Number(postId)); }
  }
  if (room.size === 0) rooms.delete(Number(postId));
  if (changed) broadcast(io, Number(postId));
}

module.exports = { join, typing, leave, leaveAll, dropUserFromBusiness, dropUserFromPost, snapshot, TYPING_FRESH_MS, _rooms: rooms };
