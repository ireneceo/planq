// services/event_stream.js — 워크스페이스 활동 타임라인 (읽기 전용)
// ─────────────────────────────────────────────────────────
//   6개 원장 테이블을 business_id 로 통합해 시간 역순 이벤트로 병합한다.
//   owner/admin 운영 뷰가 소비한다(라우트에서 게이트). 쓰기·부작용 0 → Fable 게이트 불필요.
//
//   business_id 도출:
//     audit_logs · invoice_status_history · project_status_history → 직접 컬럼
//     task_status_history → Task(task_id).business_id (join)
//     bill_events         → entity(invoice/quote).business_id (polymorphic, 2-step)
//     messages            → Conversation(conversation_id).business_id (join, 메타데이터만·본문 제외)
//
//   actor 정규화: user_id · actor_user_id · changed_by · sender_id → actor_user_id.
//     users.is_ai 로 사람/AI 파생(사후 배치 조회).

const { Op } = require('sequelize');
const {
  AuditLog, TaskStatusHistory, InvoiceStatusHistory, ProjectStatusHistory,
  BillEvent, Message, Task, Conversation, Invoice, Quote, User,
} = require('../models');

// 소스 카테고리 — kinds 필터가 이 이름들을 받는다
const SOURCES = ['audit', 'task', 'invoice', 'project', 'bill', 'message'];

const iso = (d) => (d ? new Date(d).toISOString() : null);

// ─── 통합 스트림 ───
//   opts: { since?: Date|ISO, actor?: userId, kinds?: string[], limit?: number }
//   반환: [{ id, source, kind, at, actor_user_id, actor_name, actor_is_ai,
//            entity_type, entity_id, from_status, to_status, summary }] (시간 역순)
async function getWorkspaceStream(businessId, opts = {}) {
  const bizId = Number(businessId);
  if (!bizId) return [];

  const since = opts.since ? new Date(opts.since) : null;
  const actor = opts.actor ? Number(opts.actor) : null;
  const kinds = (Array.isArray(opts.kinds) && opts.kinds.length)
    ? opts.kinds.filter((k) => SOURCES.includes(k))
    : SOURCES;
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 500);
  // 이미 본 행이 조금 섞여 오므로 넉넉히 — 인덱스 있는 조회라 실제 페치는 존재 행수로 바운드된다.
  //   limit 에 연동하면 limit=1 일 때 창이 24로 좁아져 같은 시각 대량 클러스터에서 조기 종료했다(실측).
  const perSource = 400;   // 소스별 최대 limit → 병합 후 상위 limit 로 다시 자른다

  const timeWhere = since ? { created_at: { [Op.gte]: since } } : {};
  const want = (k) => kinds.includes(k);
  const jobs = [];

  // ── audit_logs (business_id 직접, actor=user_id) ──
  if (want('audit')) jobs.push(
    AuditLog.findAll({
      where: { business_id: bizId, ...(actor ? { user_id: actor } : {}), ...timeWhere },
      attributes: ['id', 'action', 'target_type', 'target_id', 'user_id', 'created_at'],
      order: [['created_at', 'DESC']], limit: perSource, raw: true,
    }).then((rows) => rows.map((r) => ({
      id: `audit:${r.id}`, source: 'audit', kind: r.action,
      at: iso(r.created_at), actor_user_id: r.user_id,
      entity_type: r.target_type || null, entity_id: r.target_id || null,
      from_status: null, to_status: null, summary: r.action,
    })))
  );

  // ── invoice_status_history (business_id 직접, actor=changed_by) ──
  if (want('invoice')) jobs.push(
    InvoiceStatusHistory.findAll({
      where: { business_id: bizId, ...(actor ? { changed_by: actor } : {}), ...timeWhere },
      attributes: ['id', 'invoice_id', 'from_status', 'to_status', 'changed_by', 'created_at'],
      order: [['created_at', 'DESC']], limit: perSource, raw: true,
    }).then((rows) => rows.map((r) => ({
      id: `invoice:${r.id}`, source: 'invoice', kind: `invoice.${r.to_status}`,
      at: iso(r.created_at), actor_user_id: r.changed_by,
      entity_type: 'invoice', entity_id: r.invoice_id,
      from_status: r.from_status || null, to_status: r.to_status || null,
      summary: `invoice ${r.from_status || '·'} → ${r.to_status}`,
    })))
  );

  // ── project_status_history (business_id 직접, actor=changed_by) ──
  if (want('project')) jobs.push(
    ProjectStatusHistory.findAll({
      where: { business_id: bizId, ...(actor ? { changed_by: actor } : {}), ...timeWhere },
      attributes: ['id', 'project_id', 'from_status', 'to_status', 'changed_by', 'created_at'],
      order: [['created_at', 'DESC']], limit: perSource, raw: true,
    }).then((rows) => rows.map((r) => ({
      id: `project:${r.id}`, source: 'project', kind: `project.${r.to_status}`,
      at: iso(r.created_at), actor_user_id: r.changed_by,
      entity_type: 'project', entity_id: r.project_id,
      from_status: r.from_status || null, to_status: r.to_status || null,
      summary: `project ${r.from_status || '·'} → ${r.to_status}`,
    })))
  );

  // ── task_status_history (Task.business_id join, actor=actor_user_id) ──
  if (want('task')) jobs.push(
    TaskStatusHistory.findAll({
      where: { ...(actor ? { actor_user_id: actor } : {}), ...timeWhere },
      attributes: ['id', 'task_id', 'event_type', 'from_status', 'to_status', 'actor_user_id', 'created_at'],
      include: [{ model: Task, attributes: ['id'], where: { business_id: bizId }, required: true }],
      order: [['created_at', 'DESC']], limit: perSource,
    }).then((rows) => rows.map((r) => ({
      id: `task:${r.id}`, source: 'task', kind: `task.${r.event_type || r.to_status}`,
      at: iso(r.created_at), actor_user_id: r.actor_user_id,
      entity_type: 'task', entity_id: r.task_id,
      from_status: r.from_status || null, to_status: r.to_status || null,
      summary: `task ${r.event_type || `${r.from_status || '·'} → ${r.to_status}`}`,
    })))
  );

  // ── bill_events (polymorphic — invoice/quote id 를 먼저 모은 뒤 IN 조회) ──
  if (want('bill')) jobs.push((async () => {
    const [invIds, quoteIds] = await Promise.all([
      Invoice.findAll({ where: { business_id: bizId }, attributes: ['id'], raw: true }).then((r) => r.map((x) => x.id)),
      Quote.findAll({ where: { business_id: bizId }, attributes: ['id'], raw: true }).then((r) => r.map((x) => x.id)),
    ]);
    const or = [];
    if (invIds.length) or.push({ entity_type: 'invoice', entity_id: { [Op.in]: invIds } });
    if (quoteIds.length) or.push({ entity_type: 'quote', entity_id: { [Op.in]: quoteIds } });
    if (!or.length) return [];
    const rows = await BillEvent.findAll({
      where: { ...(actor ? { actor_user_id: actor } : {}), ...timeWhere, [Op.or]: or },
      attributes: ['id', 'entity_type', 'entity_id', 'event_type', 'actor_user_id', 'created_at'],
      order: [['created_at', 'DESC']], limit: perSource, raw: true,
    });
    return rows.map((r) => ({
      id: `bill:${r.id}`, source: 'bill', kind: `bill.${r.event_type}`,
      at: iso(r.created_at), actor_user_id: r.actor_user_id,
      entity_type: r.entity_type, entity_id: r.entity_id,
      from_status: null, to_status: null, summary: `${r.entity_type} ${r.event_type}`,
    }));
  })());

  // ── messages (Conversation.business_id join, actor=sender_id, 본문 제외·메타데이터만) ──
  if (want('message')) jobs.push(
    Message.findAll({
      where: { is_deleted: false, ...(actor ? { sender_id: actor } : {}), ...timeWhere },
      attributes: ['id', 'conversation_id', 'sender_id', 'created_at'],
      include: [{ model: Conversation, attributes: ['id'], where: { business_id: bizId }, required: true }],
      order: [['created_at', 'DESC']], limit: perSource,
    }).then((rows) => rows.map((r) => ({
      id: `message:${r.id}`, source: 'message', kind: 'message.sent',
      at: iso(r.created_at), actor_user_id: r.sender_id,
      entity_type: 'conversation', entity_id: r.conversation_id,
      from_status: null, to_status: null, summary: 'message sent',
    })))
  );

  const merged = (await Promise.all(jobs)).flat();
  merged.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const top = merged.slice(0, limit);

  // ── actor 배치 조회 — 사람/AI 파생 ──
  const actorIds = [...new Set(top.map((e) => e.actor_user_id).filter(Boolean))];
  const actorMap = new Map();
  if (actorIds.length) {
    const users = await User.findAll({
      where: { id: { [Op.in]: actorIds } },
      attributes: ['id', 'name', 'username', 'is_ai'], raw: true,
    });
    users.forEach((u) => actorMap.set(u.id, u));
  }
  return top.map((e) => {
    const u = e.actor_user_id ? actorMap.get(e.actor_user_id) : null;
    return {
      ...e,
      actor_name: u ? (u.name || u.username || null) : null,
      actor_is_ai: u ? !!u.is_ai : false,
    };
  });
}

// ─── 프로젝트 히스토리 스트림 (#229) ───────────────────────────────────────
//
// 위 getWorkspaceStream 과 **다른 함수인 이유**:
//   ① 축이 다르다 — 저건 business_id 로 모으고, 이건 project_id 로 모은다.
//      audit·bill·message 는 프로젝트로 도출되지 않거나(감사·정산) 히스토리를 잡음으로 덮는다(메시지).
//   ② 권한이 다르다 — 저건 owner/admin 운영 뷰라 visibility 필터가 아예 없다.
//      여기는 **프로젝트 멤버 전원**이 보므로, 필터를 안 깔면 남의 개인 자료가 샌다.
//   그래서 저 함수는 한 글자도 건드리지 않고 골격만 복제한다.
//
// 커서 페이징 — 병합 스트림이라 offset/count 가 부정확하다. `before`(ISO) 이전 것만 소스별로
//   뽑아 병합하고 상위 limit 을 자른다.
const PROJECT_SOURCES = ['project', 'task', 'post', 'file', 'note', 'invoice'];

// 이벤트 id 는 `<접두어>:<원장 id>` — 커서 비교를 위해 둘로 나눈다.
function parseEventId(id) {
  const str = String(id || '');
  const i = str.lastIndexOf(':');
  if (i < 0) return { prefix: str, num: 0 };
  return { prefix: str.slice(0, i), num: Number(str.slice(i + 1)) || 0 };
}

async function getProjectStream(project, viewerUserId, opts = {}) {
  const projectId = Number(project && project.id);
  if (!projectId) return [];
  const bizId = Number(project.business_id);
  const viewer = Number(viewerUserId) || 0;

  const before = opts.before ? new Date(opts.before) : null;
  const beforeId = opts.beforeId ? String(opts.beforeId) : null;
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  // 이미 본 행이 조금 섞여 오므로 넉넉히 — 인덱스 있는 조회라 실제 페치는 존재 행수로 바운드된다.
  //   limit 에 연동하면 limit=1 일 때 창이 24로 좁아져 같은 시각 대량 클러스터에서 조기 종료했다(실측).
  const perSource = 400;
  const kinds = (Array.isArray(opts.kinds) && opts.kinds.length)
    ? opts.kinds.filter((k) => PROJECT_SOURCES.includes(k))
    : PROJECT_SOURCES;
  const want = (k) => kinds.includes(k);
  // ★ 커서는 **(시각, 소스, 원장 id) 전순서**로 잡는다.
  //   `created_at < before` 단독이면 같은 시각 묶음이 경계에 걸릴 때 잔여가 영영 도달 불가고,
  //   `<=` 단독이면 매번 같은 행을 다시 가져와 커서가 전진하지 못한다(둘 다 실측했다).
  //   같은 시각에서는 소스 접두어 → 원장 id 순으로 잘라 낸다.
  const cur = beforeId ? parseEventId(beforeId) : null;

  // ★ 커서 절단은 **한 곳에서만** 한다 — 병합 후 (at, 소스, 원장 id) 전순서 필터.
  //   SQL 로 정교하게 자르려던 첫 시도는 두 번 깨졌다:
  //     ① 테이블마다 시각 정밀도가 다르다 — project_notes 는 `datetime`(초), posts 는 `datetime(3)`.
  //        MySQL 은 DATETIME(0) 컬럼을 소수점 있는 값과 비교할 때 **초로 반올림**해서, 커서가
  //        밀리초를 가진 행일 때 같은 초의 노트가 통째로 빠졌다(실측 0건).
  //     ② 같은 초 안에서 id 순서와 시각 순서가 일치하지 않는다(밀리초가 있으면 id 작은 쪽이 더 늦다).
  //   그래서 SQL 은 **경계 초까지 넉넉히** 가져오고(초 단위 내림), 정확한 비교는 아래 필터가 한다.
  //   대신 이미 본 행이 섞여 오므로 소스별로 넉넉히 오버페치한다 — 안 그러면 커서가 전진하지 못한다.
  //   경계 초의 **끝**(.999)까지 포함해야 한다 — 초로 내림하면 같은 초의 밀리초 행(post .785)이
  //   잘려 나간다(실측: limit 작을 때 post 유실). 넉넉히 담고 아래 필터가 정확히 자른다.
  //   해결: **커서와 같은 소스**는 그 테이블에서 나온 시각이라 정밀도가 일치한다 → 정확 비교 가능.
  //         (`< before` 또는 `= before AND id > 커서id`. 같은 초 클러스터가 아무리 커도 창에 안 갇힌다.)
  //         **다른 소스**는 `<= before` — `<` 를 쓰면 위 반올림 때문에 같은 초가 통째로 빠지고,
  //         `<=` 면 반올림이 오히려 경계 초를 포함시켜 준다. 이미 본 행이 조금 섞여 와도 필터가 자른다.
  const timeWhereFor = (prefix) => {
    if (!before) return {};
    if (!cur || prefix !== cur.prefix) return { created_at: { [Op.lte]: before } };
    return {
      [Op.or]: [
        { created_at: { [Op.lt]: before } },
        { created_at: before, id: { [Op.gt]: cur.num } },
      ],
    };
  };

  const {
    Post, File, ProjectNote, Project,
  } = require('../models');

  const jobs = [];

  // ── 프로젝트 생성 + 상태 전이 ──
  if (want('project')) {
    jobs.push(
      ProjectStatusHistory.findAll({
        where: { project_id: projectId, ...timeWhereFor('project') },
        attributes: ['id', 'from_status', 'to_status', 'changed_by', 'created_at'],
        order: [['created_at', 'DESC'], ['id', 'ASC']], limit: perSource, raw: true,
      }).then((rows) => rows.map((r) => ({
        id: `project:${r.id}`, source: 'project', kind: `project.${r.to_status}`,
        at: iso(r.created_at), actor_user_id: r.changed_by,
        entity_type: 'project', entity_id: projectId,
        from_status: r.from_status || null, to_status: r.to_status || null,
        title: project.name || null,
      })))
    );
    // 생성 이벤트는 원장이 없다 — projects.created_at 으로 1건 합성한다.
    //   ★ 여기서 strict `<` 로 잘라내면 **전순서에 참여하지 못해 영구 유실**된다.
    //   프로젝트 생성과 템플릿 시드는 같은 초를 공유하는 것이 흔한데(실측: dev 프로젝트 35),
    //   커서가 그 시각의 다른 소스에 걸리는 순간 "프로젝트 시작" 이 영영 안 나온다.
    //   동시각이면 일단 만들고, 아래 병합 후 필터가 같은 전순서로 자르게 둔다.
    //   (cur 가 없는 옛 경로는 중복 방지를 위해 strict `<` 유지.)
    const createdAt = project.created_at || project.createdAt;
    const createdMs = createdAt ? new Date(createdAt).getTime() : 0;
    const includeCreated = !!createdAt && (
      !before
      || createdMs < before.getTime()
      // 같은 **초** 면 일단 만들고 아래 전순서 필터가 자르게 둔다 (정밀도가 달라 밀리초로 비교하면 샌다)
      || (!!cur && Math.floor(createdMs / 1000) === Math.floor(before.getTime() / 1000))
    );
    if (includeCreated) {
      jobs.push(Promise.resolve([{
        id: `project-created:${projectId}`, source: 'project', kind: 'project.created',
        at: iso(createdAt), actor_user_id: project.owner_user_id || null,
        entity_type: 'project', entity_id: projectId,
        from_status: null, to_status: null, title: project.name || null,
      }]));
    }
  }

  // ── 업무 생성 ──
  if (want('task')) {
    jobs.push(
      Task.findAll({
        where: { project_id: projectId, business_id: bizId, ...timeWhereFor('task-created') },
        attributes: ['id', 'title', 'created_by', 'created_at'],
        order: [['created_at', 'DESC'], ['id', 'ASC']], limit: perSource, raw: true,
      }).then((rows) => rows.map((r) => ({
        id: `task-created:${r.id}`, source: 'task', kind: 'task.created',
        at: iso(r.created_at), actor_user_id: r.created_by,
        entity_type: 'task', entity_id: r.id,
        from_status: null, to_status: null, title: r.title || null,
      })))
    );
    // 완료·취소만 — 전이 전종을 넣으면 히스토리가 상태 변경 로그로 덮인다.
    jobs.push(
      // ★ 컬럼명이 원장마다 다르다 — task_status_history 는 `actor_user_id`,
      //   project_status_history 는 `changed_by`. 같다고 가정하면 500 이 난다(실제로 났다).
      TaskStatusHistory.findAll({
        where: { to_status: { [Op.in]: ['completed', 'canceled'] }, ...timeWhereFor('task-status') },
        // ★ include 가 있으면 raw:true 를 못 쓴다 → 결과가 **인스턴스**다. 그때 attributes 에
        //   컬럼명('created_at')을 넣으면 값이 dataValues 에만 실려 `r.created_at` 이 undefined 가 된다.
        //   그러면 at 이 null 이 되어 아래 filter 에서 **에러도 경고도 없이 통째로 사라진다**
        //   (이 브랜치가 통으로 죽어 task 완료/취소가 히스토리에 영영 안 나왔다).
        //   모델 속성명 'createdAt' 을 쓴다.
        attributes: ['id', 'task_id', 'from_status', 'to_status', 'actor_user_id', 'createdAt'],
        include: [{ model: Task, attributes: ['id', 'title'], where: { project_id: projectId, business_id: bizId }, required: true }],
        order: [['created_at', 'DESC'], ['id', 'ASC']], limit: perSource,
      }).then((rows) => rows.map((r) => ({
        id: `task-status:${r.id}`, source: 'task', kind: `task.${r.to_status}`,
        at: iso(r.createdAt), actor_user_id: r.actor_user_id,
        entity_type: 'task', entity_id: r.task_id,
        from_status: r.from_status || null, to_status: r.to_status || null,
        title: (r.Task && r.Task.title) || null,
      })))
    );
  }

  // ── 문서(post) ──
  //   ★ vlevel 은 nullable 이다. `vlevel != 'L1'` 로만 쓰면 NULL 행이 SQL 3치 논리로 통째로 빠진다.
  if (want('post')) {
    jobs.push(
      Post.findAll({
        // ★ [Op.or] 를 같은 객체에 두 번 쓰면 뒤엣것이 앞엣것을 **통째로 덮는다**(심볼도 그냥 키다).
        //   timeWhereFor 가 Op.or 를 돌려줄 수 있어, 커서 조건이 조용히 사라졌었다 → [Op.and] 로 합친다.
        where: {
          project_id: projectId, business_id: bizId,
          [Op.and]: [
            timeWhereFor('post'),
            { [Op.or]: [
              { vlevel: { [Op.is]: null } },
              { vlevel: { [Op.ne]: 'L1' } },
              { author_id: viewer },
            ] },
          ],
        },
        attributes: ['id', 'title', 'author_id', 'created_at'],
        order: [['created_at', 'DESC'], ['id', 'ASC']], limit: perSource, raw: true,
      }).then((rows) => rows.map((r) => ({
        id: `post:${r.id}`, source: 'post', kind: 'post.created',
        at: iso(r.created_at), actor_user_id: r.author_id,
        entity_type: 'post', entity_id: r.id,
        from_status: null, to_status: null, title: r.title || null,
      })))
    );
  }

  // ── 파일 ──
  if (want('file')) {
    jobs.push(
      File.findAll({
        where: {
          project_id: projectId, business_id: bizId, deleted_at: null,
          [Op.and]: [
            timeWhereFor('file'),
            { [Op.or]: [
              { vlevel: { [Op.is]: null } },
              { vlevel: { [Op.ne]: 'L1' } },
              { uploader_id: viewer },
            ] },
          ],
        },
        attributes: ['id', 'file_name', 'uploader_id', 'created_at'],
        order: [['created_at', 'DESC'], ['id', 'ASC']], limit: perSource, raw: true,
      }).then((rows) => rows.map((r) => ({
        id: `file:${r.id}`, source: 'file', kind: 'file.uploaded',
        at: iso(r.created_at), actor_user_id: r.uploader_id,
        entity_type: 'file', entity_id: r.id,
        from_status: null, to_status: null, title: r.file_name || null,
      })))
    );
  }

  // ── 노트 (personal 은 본인 것만) ──
  if (want('note')) {
    jobs.push(
      ProjectNote.findAll({
        where: {
          project_id: projectId,
          [Op.and]: [
            timeWhereFor('note'),
            { [Op.or]: [
              { visibility: { [Op.ne]: 'personal' } },
              { author_user_id: viewer },
            ] },
          ],
        },
        attributes: ['id', 'body', 'author_user_id', 'created_at'],
        order: [['created_at', 'DESC'], ['id', 'ASC']], limit: perSource, raw: true,
      }).then((rows) => rows.map((r) => ({
        id: `note:${r.id}`, source: 'note', kind: 'note.created',
        at: iso(r.created_at), actor_user_id: r.author_user_id,
        entity_type: 'note', entity_id: r.id,
        from_status: null, to_status: null,
        title: String(r.body || '').replace(/\s+/g, ' ').trim().slice(0, 80) || null,
      })))
    );
  }

  // ── 청구 (발송·입금만) ──
  //   ★ 금액은 싣지 않는다. 히스토리는 "무슨 일이 있었나" 이지 재무 화면이 아니다.
  if (want('invoice')) {
    jobs.push(
      InvoiceStatusHistory.findAll({
        where: { business_id: bizId, to_status: { [Op.in]: ['sent', 'paid'] }, ...timeWhereFor('invoice') },
        // 위와 같은 이유로 모델 속성명 'createdAt' (include 브랜치라 인스턴스다)
        attributes: ['id', 'invoice_id', 'from_status', 'to_status', 'changed_by', 'createdAt'],
        include: [{ model: Invoice, attributes: ['id', 'invoice_number', 'title'], where: { project_id: projectId }, required: true }],
        order: [['created_at', 'DESC'], ['id', 'ASC']], limit: perSource,
      }).then((rows) => rows.map((r) => ({
        id: `invoice:${r.id}`, source: 'invoice', kind: `invoice.${r.to_status}`,
        at: iso(r.createdAt), actor_user_id: r.changed_by,
        entity_type: 'invoice', entity_id: r.invoice_id,
        from_status: r.from_status || null, to_status: r.to_status || null,
        title: (r.Invoice && (r.Invoice.title || r.Invoice.invoice_number)) || null,
      }))).catch((e) => { console.warn('[event_stream] project invoice', e.message); return []; })
    );
  }

  // 전순서: 시각 내림차순 → 소스 접두어 오름차순 → 원장 id 오름차순.
  //   문자열 id 를 그대로 비교하면 'note:99' > 'note:137' 이 되어 순서가 뒤집힌다(숫자로 본다).
  const cmp = (a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1;
    const pa = parseEventId(a.id); const pb = parseEventId(b.id);
    if (pa.prefix !== pb.prefix) return pa.prefix < pb.prefix ? -1 : 1;
    return pa.num - pb.num;
  };
  const results = await Promise.all(jobs);
  // 포화 감지 — 한 소스가 창을 꽉 채웠다는 것은 그 소스만으로 창이 모자랄 수 있다는 신호다.
  //   같은 소스는 정확 커서라 갇히지 않지만, 다른 소스가 이 상태면 조용히 잘릴 여지가 남는다.
  for (const rows of results) {
    if (Array.isArray(rows) && rows.length >= perSource) {
      console.warn(`[event_stream] getProjectStream 창 포화 (project=${projectId}, ${rows.length}건) — 커서 경계 점검 필요`);
    }
  }
  let merged = results.flat().filter((e) => e && e.at);
  merged.sort(cmp);
  if (before) {
    const beforeIso = before.toISOString();
    merged = merged.filter((e) => {
      if (e.at < beforeIso) return true;      // 확실히 더 과거
      if (e.at !== beforeIso) return false;   // 커서보다 최신 — 이미 본 것
      if (!cur) return false;
      const pe = parseEventId(e.id);          // 시각이 정확히 같으면 소스·원장 id 로 자른다
      return pe.prefix > cur.prefix || (pe.prefix === cur.prefix && pe.num > cur.num);
    });
  }
  const top = merged.slice(0, limit);

  const actorIds = [...new Set(top.map((e) => e.actor_user_id).filter(Boolean))];
  const actorMap = new Map();
  if (actorIds.length) {
    const users = await User.findAll({
      where: { id: { [Op.in]: actorIds } },
      attributes: ['id', 'name', 'username', 'is_ai'], raw: true,
    });
    users.forEach((u) => actorMap.set(u.id, u));
  }
  return top.map((e) => {
    const u = e.actor_user_id ? actorMap.get(e.actor_user_id) : null;
    return { ...e, actor_name: u ? (u.name || u.username || null) : null, actor_is_ai: u ? !!u.is_ai : false };
  });
}

module.exports = { getWorkspaceStream, getProjectStream, SOURCES, PROJECT_SOURCES };
