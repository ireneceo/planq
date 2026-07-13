// Task Candidate Extractor
// ─────────────────────────────────────────────────────────
// 채널 메시지에서 업무 후보를 LLM으로 추출한다.
// 커서 기반: conversations.last_extracted_message_id 이후 메시지만 처리.
// 후처리: guessed_role → project_members 매칭 → guessed_assignee_user_id 자동 배정.

const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const TaskCandidate = require('../models/TaskCandidate');
const ProjectMember = require('../models/ProjectMember');
const Task = require('../models/Task');
const User = require('../models/User');
const Project = require('../models/Project');
const { recordUsage, checkUsageLimit, PRICING } = require('./cue_orchestrator');
const { getMemberNameMap } = require('./displayName');

const { callLLM } = require('./llm');

const MODEL = 'gpt-4o-mini';   // 사용량 기록(recordUsage)용 라벨 — 실제 모델 선택은 게이트웨이(PURPOSES)
const MAX_MESSAGES = 50;

// ─── LLM 호출 (JSON 모드) ─── 게이트웨이 경유 (services/llm.js: 재시도·타임아웃·상한·통계)
async function callLLMJson(messages, opts = {}) {
  const r = await callLLM({
    purpose: 'task_extract',
    messages,
    json: true,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    fallback: '{"tasks":[]}',
  });
  return { content: r.content, input_tokens: r.input_tokens, output_tokens: r.output_tokens, fallback: r.fallback };
}

// ─── 프롬프트 (30년차 시각, 정밀화) ───
// 핵심 원칙:
//  1. 결정·요청·약속된 업무만 추출. 질문·보고·잡담은 절대 추출하지 않음.
//  2. 객체가 모호하면 "[   ]" placeholder 로 비워두고 사용자가 채우도록 유도.
//  3. 마감일은 EXPLICIT 한 날짜(YYYY-MM-DD / "10/6" / "내일")만 추출. "이번주/곧/조만간" → null.
//  4. 담당자 추론은 보수적: 발신자 자기 보고면 자기 / 1:1에서 부탁이면 상대 / 모호하면 null.
//  5. description 에 원문의 링크·핵심 컨텍스트를 verbatim 포함 (사용자가 등록 시 활용).
function buildExtractionPrompt(messagesText, memberNames, language, conversationParticipantNames) {
  const lang = language === 'en' ? 'English' : 'Korean';
  return `You are a senior task-extraction AI for a B2B work-chat tool. Apply STRICT precision — false positives are far worse than missing items. When unsure, RETURN EMPTY.

═══ CORE PRINCIPLES (zero-tolerance) ═══

1. EXTRACT ONLY CONFIRMED DECISIONS. Extract only when someone has explicitly committed to do X, OR has been clearly asked/assigned to do X with a yes-implied. The work must be actionable, future-tense, and undecided-state.

2. CRITICAL DISTINCTION — REVIEW REQUEST vs DELIVERABLE REQUEST:
   ▸ NOT a task (review/confirmation requests):
     - "확인 부탁드려요" / "확인해 주실 수 있나요?" — review existing work
     - "검토 부탁드려요" / "봐주세요" / "보내드린 거 한번 보세요" — review request
     - "잘 됐나요?" / "괜찮을까요?" — status question
     - "이거 어떻게 하면 될까요?" — discussion question
     - "시간 되실 때 봐주세요" — soft review ask
   ▸ IS a task (NEW deliverable requests — ALWAYS extract):
     - "X 만들어 주세요" / "X 제작 부탁드려요" — new creation
     - "X 디자인 좀 해줘요" / "X 디자인 부탁해요" — new design deliverable
     - "X 작성 부탁드려요" / "X 작성해 주세요" — new document
     - "X 개발 부탁드려요" / "X 코딩 좀" — new code
     - "X 좀 해줘요" / "X 해주세요" with NEW output context (file/design/doc) — new deliverable

   Rule of thumb: If the request produces NEW output (design/document/code/file/asset),
   it IS a task — extract it even if other parts of the message are reviews or chitchat.
   ONE MESSAGE CAN CONTAIN MULTIPLE DELIVERABLES — extract each one separately.
   The exception: when someone RESPONDS "네, 할게요" committing to produce, that is also a task.

3. NEVER extract from REPORTS of completed/in-progress work. Examples:
   - "수정 완료했습니다" / "올렸어요" / "끝냈어요" — past report
   - "지금 작업 중이에요" — already in progress
   These are STATUS UPDATES, not new tasks.

4. NEVER GUESS DEADLINES.
   - guessed_due_date = ONLY when an explicit date is given: "10월 6일", "2026-10-06", "내일", "다음주 월요일"
   - "이번주", "곧", "조만간", "최대한 빨리" → guessed_due_date = null
   - "시간 될 때" → guessed_due_date = null

5. PLACEHOLDER FOR MISSING OBJECTS.
   When the action verb is clear but the OBJECT (what?) is not, insert "[   ]" (3 spaces in brackets) where the missing detail would go.
   - "이번주에 업로드 하려구요" → if we don't know what to upload: title="[   ] 업로드"
   - "작성해 주세요" with no clear document → title="[   ] 작성"
   The user will fill in the bracket later when registering. Better empty than wrong.

═══ ASSIGNEE INFERENCE (conservative) ═══

guessed_role / guessed_assignee_name 은 다음 케이스에만 채움:
- (a) 발신자가 "내가 X 할게요/할 예정입니다" 명시 → 발신자 본인이 담당자
- (b) 1:1 대화에서 발신자가 "X 해주세요/부탁드려요" 명시 → 상대방이 담당자 (대화 참여자 2명 중 발신자 아닌 사람)
- (c) "@username" 명시 멘션 → 그 사람이 담당자
- (d) "{이름}님이 X 해주세요" 명시 → 그 이름이 담당자
모호하거나 그룹 채팅에서 수신자 미특정 → null (사용자가 직접 지정)

═══ TITLE NAMING (deliverable + base verb) ═══

GOOD: "경쟁사 비교분석표 작성" / "로고 시안 3종 PDF 제작" / "[   ] 업로드"
BAD: "시장조사" / "디자인 작업" / "검토" — vague, no deliverable
BAD: "~ 제작 완료" / "~ 마무리" — completion suffix (status field 가 따로 처리)
NEVER append "완료/완성/마무리/done/finished".

═══ DESCRIPTION ═══

description 에 원문에서 언급된 핵심 컨텍스트를 verbatim 포함:
- URL 이 있으면 그 URL 그대로 (사용자가 클릭으로 이동)
- 파일명/문서명이 언급됐으면 그대로
- 핵심 요구사항 한 줄 요약

═══ CONVERSATION PARTICIPANTS ═══
${conversationParticipantNames}

═══ TEAM MEMBERS (for role matching) ═══
${memberNames}

═══ OUTPUT FORMAT (return JSON object) ═══

Return a JSON object with this exact shape:
{"tasks": [{"title": "...", "description": "...", "guessed_role": "...|null", "guessed_assignee_name": "...|null", "guessed_due_date": "YYYY-MM-DD|null", "source_message_ids": [msg_id, ...]}]}

If no actionable tasks (only questions, reports, or chitchat), return JSON: {"tasks": []}
Write title and description in ${lang}. Be conservative — empty result is better than wrong extraction.

═══ MESSAGES ═══
${messagesText}`;
}

// ─── 담당자 후보 풀 빌드 (#90: 프로젝트 멤버 ∪ 대화 참여자, 워크스페이스 표시명 포함) ───
// 30년차 시각: standalone 대화(project_id 없음)도 1:1 상대·@멘션 담당자를 잡아야 함.
// 옛 버그: resolveAssignees 가 project_id 있을 때만 돌아 standalone 은 담당자 항상 null.
// pool: Map<user_id, { user_id, role, accountName, displayName }>.
//   displayName = BusinessMember.name(워크스페이스 닉네임) → fallback 계정명. 채팅에서 부르는 이름과 정합.
async function buildAssigneePool({ businessId, projectId, conversationId }) {
  const pool = new Map();
  if (projectId) {
    const members = await ProjectMember.findAll({
      where: { project_id: projectId },
      include: [{ model: User, attributes: ['id', 'name'] }],
    });
    for (const m of members) {
      if (!m.user_id) continue;
      pool.set(m.user_id, { user_id: m.user_id, role: m.role || null, accountName: m.User?.name || null, isParticipant: false });
    }
  }
  if (conversationId) {
    const ConversationParticipant = require('../models/ConversationParticipant');
    const parts = await ConversationParticipant.findAll({
      where: { conversation_id: conversationId },
      include: [{ model: User, attributes: ['id', 'name'] }],
    });
    for (const p of parts) {
      if (!p.user_id) continue;
      const existing = pool.get(p.user_id);
      if (existing) { existing.isParticipant = true; continue; }
      pool.set(p.user_id, { user_id: p.user_id, role: p.role || null, accountName: p.User?.name || null, isParticipant: true });
    }
  }
  // 워크스페이스 표시명 덮어쓰기
  const nameMap = businessId ? await getMemberNameMap(businessId, [...pool.keys()]) : new Map();
  for (const [uid, v] of pool) {
    const dn = nameMap.get(uid);
    v.displayName = dn?.name || dn?.name_localized || v.accountName || null;
  }

  // 🔒 외부인(고객) · AI 표시 — 담당자가 될 수 없는 사람을 구분한다.
  //   대화 참여자를 그대로 풀에 넣다 보니 고객 user 가 후보에 섞였고, 1:1 고객 대화에서
  //   "김수진님, 로고 보내주세요" → 담당자 = 고객 으로 배정됐다(실증). 업무 담당자는 우리 팀이다.
  //   메일 경로 프롬프트에는 "never the customer" 가드가 있는데 채팅 경로만 없었다.
  if (businessId && pool.size > 0) {
    const BusinessMember = require('../models/BusinessMember');
    const ids = [...pool.keys()];
    const bms = await BusinessMember.findAll({
      where: { business_id: businessId, user_id: ids, removed_at: null },
      attributes: ['user_id', 'role'],
    });
    const memberRole = new Map(bms.map((m) => [m.user_id, m.role]));
    for (const [uid, v] of pool) {
      v.isExternal = !memberRole.has(uid);           // BusinessMember row 없음 = 외부 고객
      v.isAi = memberRole.get(uid) === 'ai';         // Cue — 책임 주체가 될 수 없다
    }
  }
  return pool;
}

// 담당자가 될 수 있는 사람인가 — 외부 고객·AI 제외 (사람 라우트의 assertAssignable 과 같은 취지)
function isAssignablePoolMember(m) {
  return !!m && !m.isExternal && !m.isAi;
}

// 업무명 정규화 — 결과물 기반 규칙을 코드로 보장한다.
//   프롬프트가 "NEVER append 완료/완성/마무리" 라고 못박아도 LLM 은 어긴다(운영 실데이터 2건 확인:
//   "패키지 컨셉 보드 3안 제작 완료"). status 필드가 상태를 다루므로 제목의 완료 접미사는 항상 잘라낸다.
//   프롬프트는 확률, 코드는 보장.
const TITLE_DONE_SUFFIX = /[\s·,]*(완료|완성|마무리|끝냄|done|finished|completed)\s*$/i;
function sanitizeTitle(raw) {
  let s = String(raw || '').trim();
  // 접미사가 연달아 붙는 경우("… 제작 완료 완료")도 흡수
  for (let i = 0; i < 3 && TITLE_DONE_SUFFIX.test(s); i++) s = s.replace(TITLE_DONE_SUFFIX, '').trim();
  return s.slice(0, 300);
}

// 제목 정규화 키 — pending 후보 중복 차단용 (공백·문장부호·조사 흔들림 흡수)
function titleKey(raw) {
  return String(raw || '').toLowerCase().replace(/[\s\W_]+/g, '');
}

// ─── 이름/역할 → 멤버 매칭 (LLM 출력의 guessed_assignee_name / guessed_role 우선순위) ───
// 30년차 시각: LLM 이 빈 후보를 채우려고 default_assignee 강제 부여하면 사용자에게 잘못된 추측을 강요.
// 보수적: 이름·역할 매칭 실패하면 null 반환 (사용자가 우측 패널에서 직접 지정).
// pool 은 buildAssigneePool 결과(Map). 표시명 → 계정명 → role 순 매칭.
function resolveAssignees(candidates, pool) {
  // 외부 고객·AI 는 매칭 대상에서 제외 — LLM 이 이름을 맞게 뽑았더라도 담당자가 될 수 없다.
  // (프롬프트는 확률, 코드는 보장. 메일 프롬프트의 "never the customer" 를 코드로 강제한다.)
  const members = [...(pool?.values?.() || [])].filter(isAssignablePoolMember);
  return candidates.map((c) => {
    let assigneeId = null;

    // 1차: 이름 직접 매칭 — 표시명(닉네임) 우선, 계정명 보조
    if (c.guessed_assignee_name) {
      const nameNorm = String(c.guessed_assignee_name).trim();
      const byDisplay = members.find((m) => m.displayName && String(m.displayName).trim() === nameNorm);
      const byAccount = byDisplay ? null : members.find((m) => m.accountName && String(m.accountName).trim() === nameNorm);
      const hit = byDisplay || byAccount;
      if (hit) assigneeId = hit.user_id;
    }

    // 2차: role 매칭
    if (!assigneeId && c.guessed_role) {
      const roleLower = String(c.guessed_role).toLowerCase().trim();
      const exact = members.find((m) => m.role && String(m.role).toLowerCase().trim() === roleLower);
      if (exact) {
        assigneeId = exact.user_id;
      } else {
        const partial = members.find((m) => {
          const mr = m.role ? String(m.role).toLowerCase().trim() : '';
          return mr && (mr.includes(roleLower) || roleLower.includes(mr));
        });
        if (partial) assigneeId = partial.user_id;
      }
    }

    // default_assignee fallback 제거 — 모호하면 null 유지 (사용자 결정 강요 안 함)
    return { ...c, guessed_assignee_user_id: assigneeId };
  });
}

// ─── 유사 업무 탐색 (제목 기반 간이 매칭) ───
async function findSimilarTasks(candidates, projectId) {
  const existingTasks = await Task.findAll({
    where: { project_id: projectId },
    attributes: ['id', 'title', 'status'],
  });

  if (existingTasks.length === 0) return candidates;

  return candidates.map((c) => {
    const titleLower = String(c.title).toLowerCase();
    // 단어 3개 이상 겹치면 유사 판정
    const titleWords = titleLower.split(/\s+/).filter((w) => w.length > 1);
    let bestMatch = null;
    let bestScore = 0;

    for (const t of existingTasks) {
      if (t.status === 'canceled') continue;
      const existingWords = String(t.title).toLowerCase().split(/\s+/).filter((w) => w.length > 1);
      const overlap = titleWords.filter((w) => existingWords.includes(w)).length;
      if (overlap >= 3 && overlap > bestScore) {
        bestScore = overlap;
        bestMatch = t.id;
      }
    }

    return { ...c, similar_task_id: bestMatch };
  });
}

// ─── 메인: 업무 후보 추출 ───
async function extractTaskCandidates({ conversationId, userId, businessId }) {
  const conversation = await Conversation.findByPk(conversationId);
  if (!conversation) throw new Error('conversation_not_found');
  // conversation.project_id null 이면 standalone 모드 — 담당자·유사업무 탐색은 스킵.

  // 동시 추출 방지 (10분 타임아웃)
  if (conversation.extraction_in_progress_at) {
    const elapsed = Date.now() - new Date(conversation.extraction_in_progress_at).getTime();
    if (elapsed < 10 * 60 * 1000) {
      throw new Error('extraction_already_in_progress');
    }
  }

  // 추출 시작 플래그
  await conversation.update({ extraction_in_progress_at: new Date() });

  try {
    // 커서 이후 메시지 조회
    // CRITICAL: kind='card' 메시지는 시스템 이벤트 (서명 요청·문서 공유·청구서 발송) 라 액션 아이템이 아님.
    //          LLM 에 넣으면 "[서명 요청] 견적서" 같은 카드 본문이 "견적서 작성" 업무로 오인됨 + 담당자도 카드 발행자로 잘못 추정.
    const where = {
      conversation_id: conversationId,
      is_deleted: false,
      is_ai: false, // AI 메시지 제외
      // 카드 메시지 제외 (kind IS NULL OR kind != 'card')
      [Op.or]: [
        { kind: null },
        { kind: { [Op.ne]: 'card' } },
      ],
    };
    if (conversation.last_extracted_message_id) {
      where.id = { [Op.gt]: conversation.last_extracted_message_id };
    }

    const msgs = await Message.findAll({
      where,
      order: [['id', 'ASC']],
      limit: MAX_MESSAGES,
      include: [{ model: User, as: 'sender', attributes: ['id', 'name'] }],
    });

    if (msgs.length === 0) {
      await conversation.update({ extraction_in_progress_at: null });
      return { candidates: [], message_count: 0, skipped: true, reason: 'no_new_messages' };
    }

    // ─── #90: 담당자 후보 풀 (프로젝트 멤버 ∪ 대화 참여자) + 워크스페이스 표시명 ───
    // standalone 대화도 담당자 추론하도록 pool 을 항상 빌드 (옛 버그: project_id 있을 때만 해석).
    const assigneePool = await buildAssigneePool({
      businessId,
      projectId: conversation.project_id,
      conversationId,
    });

    // 발신자 표시명 — 채팅에 보이는 이름과 정합 (LLM 추론·이름 매칭 일관)
    const senderIds = [...new Set(msgs.map((m) => m.sender_id).filter(Boolean))];
    const senderNameMap = await getMemberNameMap(businessId, senderIds);
    const nameOf = (uid, fallback) =>
      senderNameMap.get(uid)?.name || senderNameMap.get(uid)?.name_localized || assigneePool.get(uid)?.displayName || fallback;

    // 메시지 텍스트 구성 (표시명 사용)
    const messagesText = msgs.map((m) => {
      const name = nameOf(m.sender_id, m.sender?.name || `user_${m.sender_id}`);
      return `[msg_id:${m.id}] ${name}: ${m.content}`;
    }).join('\n');

    // 담당자 후보 목록 (표시명 + role) — LLM role/이름 매칭용 (standalone 도 참여자로 채워짐)
    const memberNames = [...assigneePool.values()]
      .map((m) => `- ${m.displayName || 'unknown'}${m.role ? ` (role: ${m.role})` : ''}`)
      .join('\n');

    // 대화 참여자 목록 (담당자 추론 룰: 1:1 채팅에서 상대 자동 지정용)
    const participants = [...assigneePool.values()].filter((m) => m.isParticipant);
    const participantCount = participants.length;
    const participantsList = participants
      .map((m) => {
        const tag = m.isExternal ? ' — EXTERNAL CUSTOMER, never the assignee'
          : m.isAi ? ' — AI teammate, never the assignee'
            : '';
        return `- ${m.displayName || 'unknown'} (user_id: ${m.user_id})${tag}`;
      }).join('\n');
    const conversationParticipantNames = participantCount
      ? `Total participants: ${participantCount}\n${participantsList}\n`
        + `Note: ${participantCount === 2 ? 'This is a 1-on-1 chat — when the sender asks the other person to do X, that person is the assignee.' : 'Group chat — only assign when explicitly named.'}\n`
        // 메일 경로와 같은 가드 — 고객이 무언가를 요청하면 담당자는 우리 팀원이다 (고객이 아니라).
        + 'CRITICAL: the assignee is always one of OUR team members. When an EXTERNAL CUSTOMER asks for a deliverable, the assignee is our team member (never the customer). If no internal person is clearly named, leave the assignee null.'
      : '';

    // 언어 감지 (간이: 한글 포함 여부)
    const hasKorean = /[가-힣]/.test(messagesText);
    const language = hasKorean ? 'ko' : 'en';

    // 워크스페이스 월 Cue 한도 검사 — 초과 시 추출 skip (다음 cron 사이클에 다시 시도)
    try {
      const usage = await checkUsageLimit(businessId);
      if (usage.over) {
        console.warn('[task_extractor] usage limit exceeded — skip', { businessId, total: usage.total, limit: usage.limit });
        return { extracted: 0, skipped: 'usage_limit_exceeded' };
      }
    } catch { /* checkUsageLimit 실패 시 통과 (best-effort) */ }

    // LLM 호출
    const prompt = buildExtractionPrompt(messagesText, memberNames, language, conversationParticipantNames);
    const llmResult = await callLLMJson([
      { role: 'system', content: prompt },
    ], { temperature: 0.1, maxTokens: 1500 });

    // 사용량 기록
    await recordUsage(businessId, 'task_extraction', MODEL, llmResult.input_tokens, llmResult.output_tokens);

    // JSON 파싱
    let extracted = [];
    try {
      const parsed = JSON.parse(llmResult.content);
      extracted = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    } catch (e) {
      console.warn('[task_extractor] JSON parse failed', llmResult.content.slice(0, 200));
      extracted = [];
    }

    if (extracted.length === 0) {
      // 커서만 전진 (빈 결과라도)
      const lastMsgId = msgs[msgs.length - 1].id;
      await conversation.update({
        last_extracted_message_id: lastMsgId,
        last_extracted_at: new Date(),
        extraction_in_progress_at: null,
      });
      return { candidates: [], message_count: msgs.length, skipped: false, reason: 'no_tasks_found', fallback: llmResult.fallback };
    }

    // source_message_ids 검증 (실제 존재하는 ID만)
    const validMsgIds = new Set(msgs.map((m) => m.id));
    extracted = extracted.map((t) => ({
      ...t,
      source_message_ids: Array.isArray(t.source_message_ids)
        ? t.source_message_ids.filter((id) => validMsgIds.has(Number(id)))
        : [],
    }));

    // ─── 이미 처리된 메시지 차단 ───
    // task 로 등록(registered) + 다른 task 로 병합(merged) + 사용자가 거절(rejected) 한 candidate 의 source 메시지는
    // LLM 이 같은 작업을 반복 추출할 수 있으므로 자동 폐기.
    // 컨텍스트 유지를 위해 LLM 입력에는 포함되되, 결과 후처리에서 source 가 ⊆ blocked 면 제거.
    const tasksWithSource = await Task.findAll({
      where: { conversation_id: conversationId, source_message_id: { [Op.ne]: null } },
      attributes: ['source_message_id'],
    });
    const resolvedCandidates = await TaskCandidate.findAll({
      where: {
        conversation_id: conversationId,
        status: { [Op.in]: ['registered', 'merged', 'rejected'] },
      },
      attributes: ['source_message_ids'],
    });
    const blockedIds = new Set();
    for (const t of tasksWithSource) blockedIds.add(Number(t.source_message_id));
    for (const c of resolvedCandidates) {
      for (const id of (c.source_message_ids || [])) blockedIds.add(Number(id));
    }
    extracted = extracted.filter((t) => {
      const ids = (t.source_message_ids || []).map(Number);
      if (ids.length === 0) return true; // source 없으면 통과 (LLM 이 message_id 못 짚은 경우)
      return !ids.every((id) => blockedIds.has(id)); // 모든 source 가 blocked 면 폐기
    });

    // ─── 아직 처리 안 된(pending) 후보와 같은 업무는 다시 만들지 않는다 ───
    // "배너 3종 제작해 주세요" → 후보 생성. 나중에 "배너 3종 제작 잊지 마세요" → 같은 후보가 또 생김(실증).
    // blockedIds 는 registered/merged/rejected 만 봐서 pending 이 빠져 있었다.
    // Q Note 경로는 이미 title 기반 dedup 을 한다 — 채팅·메일만 없던 비대칭.
    const pendingCands = await TaskCandidate.findAll({
      where: { conversation_id: conversationId, status: 'pending' },
      attributes: ['title'],
    });
    const pendingKeys = new Set(pendingCands.map((c) => titleKey(c.title)));
    if (pendingKeys.size > 0) {
      extracted = extracted.filter((t) => {
        const k = titleKey(sanitizeTitle(t.title));
        return !(k && pendingKeys.has(k));
      });
    }

    // 역할/이름 → 담당자 매칭 (#90: standalone 포함 — pool 에 대화 참여자가 있어 1:1 상대·@멘션 해석 가능).
    // 유사 업무 탐색은 프로젝트 컨텍스트 필요하므로 project_id 있을 때만.
    let withSimilar = resolveAssignees(extracted, assigneePool);
    if (conversation.project_id) {
      withSimilar = await findSimilarTasks(withSimilar, conversation.project_id);
    }

    // DB 저장 (트랜잭션)
    const t = await sequelize.transaction();
    try {
      const created = [];
      for (const c of withSimilar) {
        // 사이클 N+14 hotfix — guessed_due_date sanitize.
        // LLM 이 빈 문자열 / 'null' / 'Invalid date' / 'YYYY-MM-DD' 외 형식 반환 시 DATE INSERT fail.
        // 유효한 YYYY-MM-DD 형식만 통과시키고 나머지는 null.
        const rawDate = c.guessed_due_date;
        let safeDate = null;
        if (rawDate && typeof rawDate === 'string') {
          const trimmed = rawDate.trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            const d = new Date(trimmed + 'T00:00:00');
            if (!isNaN(d.getTime())) safeDate = trimmed;
          }
        }
        const candidate = await TaskCandidate.create({
          project_id: conversation.project_id,
          conversation_id: conversationId,
          extracted_at: new Date(),
          extracted_by_user_id: userId,
          source_message_ids: c.source_message_ids || [],
          title: sanitizeTitle(c.title),
          description: c.description ? String(c.description).slice(0, 2000) : null,
          guessed_role: c.guessed_role ? String(c.guessed_role).slice(0, 50) : null,
          guessed_assignee_user_id: c.guessed_assignee_user_id || null,
          guessed_due_date: safeDate,
          similar_task_id: c.similar_task_id || null,
          recurrence_hint: c.recurrence_hint || null,
          status: 'pending',
        }, { transaction: t });
        created.push(candidate);
      }

      // 커서 전진
      const lastMsgId = msgs[msgs.length - 1].id;
      await conversation.update({
        last_extracted_message_id: lastMsgId,
        last_extracted_at: new Date(),
        extraction_in_progress_at: null,
      }, { transaction: t });

      await t.commit();

      // 생성된 후보에 assignee 정보 붙여서 반환
      const result = [];
      for (const c of created) {
        const full = await TaskCandidate.findByPk(c.id, {
          include: [{ model: User, as: 'guessedAssignee', attributes: ['id', 'name'] }],
        });
        result.push(full.toJSON());
      }

      return {
        candidates: result,
        message_count: msgs.length,
        skipped: false,
        fallback: llmResult.fallback,
      };
    } catch (err) {
      await t.rollback();
      throw err;
    }
  } catch (err) {
    // 실패 시 플래그 해제
    await conversation.update({ extraction_in_progress_at: null }).catch(() => {});
    throw err;
  }
}

// ─── 메일 스레드 → 업무 후보 추출 (N+87 Phase B) ───
//   extractTaskCandidates 와 동일 파이프라인(프롬프트·LLM·assignee·유사업무·dedup) 재사용.
//   입력만 email_messages, 스코프는 email_thread_id + source_email_message_ids.
async function extractEmailTaskCandidates({ emailThreadId, userId, businessId }) {
  const EmailThread = require('../models/EmailThread');
  const EmailMessage = require('../models/EmailMessage');
  const BusinessMember = require('../models/BusinessMember');
  const thread = await EmailThread.findByPk(emailThreadId);
  if (!thread) throw new Error('thread_not_found');

  const msgs = await EmailMessage.findAll({
    where: { thread_id: emailThreadId, business_id: businessId },
    order: [['sent_at', 'ASC'], ['id', 'ASC']],
    limit: MAX_MESSAGES,
    attributes: ['id', 'from_name', 'from_email', 'direction', 'subject', 'body_text'],
  });
  if (msgs.length === 0) return { candidates: [], message_count: 0, skipped: true, reason: 'no_messages' };

  // 메일 본문 텍스트 — inbound=고객 요청 / outbound=우리 팀 약속
  const messagesText = msgs.map((m) => {
    const name = m.from_name || m.from_email || `msg_${m.id}`;
    const who = m.direction === 'outbound' ? '우리 팀' : '고객';
    const body = (m.body_text || m.subject || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
    return `[msg_id:${m.id}] ${name} (${who}): ${body}`;
  }).join('\n');

  // 담당자 후보 — 프로젝트 연결 시 프로젝트 멤버, 아니면 워크스페이스 멤버
  let memberNames = '';
  if (thread.project_id) {
    const members = await ProjectMember.findAll({ where: { project_id: thread.project_id }, include: [{ model: User, attributes: ['id', 'name'] }] });
    memberNames = members.map((m) => `- ${m.User?.name || 'unknown'} (role: ${m.role})`).join('\n');
  } else {
    const bms = await BusinessMember.findAll({ where: { business_id: businessId, removed_at: null }, include: [{ model: User, as: 'user', attributes: ['id', 'name'] }] });
    memberNames = bms.map((m) => `- ${m.user?.name || 'unknown'} (role: ${m.role})`).join('\n');
  }
  const participantNote = `Email thread (subject: ${thread.subject || ''}). Inbound = customer's request, outbound = our team. When the customer requests a deliverable, the assignee is one of OUR team members above (never the customer). When our team promises something, that sender is the assignee.`;

  const language = /[가-힣]/.test(messagesText) ? 'ko' : 'en';
  try { const usage = await checkUsageLimit(businessId); if (usage.over) return { candidates: [], skipped: 'usage_limit_exceeded' }; } catch { /* best-effort */ }

  const prompt = buildExtractionPrompt(messagesText, memberNames, language, participantNote);
  const llmResult = await callLLMJson([{ role: 'system', content: prompt }], { temperature: 0.1, maxTokens: 1500 });
  await recordUsage(businessId, 'task_extraction', MODEL, llmResult.input_tokens, llmResult.output_tokens);

  let extracted = [];
  try { const parsed = JSON.parse(llmResult.content); extracted = Array.isArray(parsed.tasks) ? parsed.tasks : []; } catch { extracted = []; }
  if (extracted.length === 0) return { candidates: [], message_count: msgs.length, reason: 'no_tasks_found', fallback: llmResult.fallback };

  // source 검증 (LLM 의 source_message_ids → 메일 메시지 id)
  const validIds = new Set(msgs.map((m) => m.id));
  extracted = extracted.map((t) => ({
    ...t,
    source_email_message_ids: Array.isArray(t.source_message_ids) ? t.source_message_ids.map(Number).filter((id) => validIds.has(id)) : [],
  }));

  // dedup — 이미 등록/병합/거절된 후보 + source 가진 task 의 메일 메시지 차단
  const resolvedC = await TaskCandidate.findAll({ where: { email_thread_id: emailThreadId, status: { [Op.in]: ['registered', 'merged', 'rejected'] } }, attributes: ['source_email_message_ids'] });
  const tasksWithSrc = await Task.findAll({ where: { email_thread_id: emailThreadId, source_email_message_id: { [Op.ne]: null } }, attributes: ['source_email_message_id'] });
  const blocked = new Set();
  for (const c of resolvedC) for (const id of (c.source_email_message_ids || [])) blocked.add(Number(id));
  for (const t of tasksWithSrc) blocked.add(Number(t.source_email_message_id));
  extracted = extracted.filter((t) => { const ids = (t.source_email_message_ids || []).map(Number); if (!ids.length) return true; return !ids.every((id) => blocked.has(id)); });

  // assignee (#90: 프로젝트 멤버 풀 + 표시명 매칭) + 유사업무 (프로젝트 연결 시만)
  let withSimilar = extracted;
  if (thread.project_id) {
    const emailPool = await buildAssigneePool({ businessId, projectId: thread.project_id, conversationId: null });
    const wa = resolveAssignees(extracted, emailPool);
    withSimilar = await findSimilarTasks(wa, thread.project_id);
  }

  const tx = await sequelize.transaction();
  try {
    const created = [];
    for (const c of withSimilar) {
      const rawDate = c.guessed_due_date; let safeDate = null;
      if (rawDate && typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())) {
        const d = new Date(rawDate.trim() + 'T00:00:00'); if (!isNaN(d.getTime())) safeDate = rawDate.trim();
      }
      const cand = await TaskCandidate.create({
        project_id: thread.project_id || null,
        conversation_id: null,
        email_thread_id: emailThreadId,
        extracted_at: new Date(),
        extracted_by_user_id: userId,
        source_message_ids: null,
        source_email_message_ids: c.source_email_message_ids || [],
        title: sanitizeTitle(c.title),
        description: c.description ? String(c.description).slice(0, 2000) : null,
        guessed_role: c.guessed_role ? String(c.guessed_role).slice(0, 50) : null,
        guessed_assignee_user_id: c.guessed_assignee_user_id || null,
        guessed_due_date: safeDate,
        similar_task_id: c.similar_task_id || null,
        recurrence_hint: c.recurrence_hint || null,
        status: 'pending',
      }, { transaction: tx });
      created.push(cand);
    }
    await tx.commit();
    const result = [];
    for (const c of created) {
      const full = await TaskCandidate.findByPk(c.id, { include: [{ model: User, as: 'guessedAssignee', attributes: ['id', 'name'] }] });
      result.push(full.toJSON());
    }
    return { candidates: result, message_count: msgs.length, fallback: llmResult.fallback };
  } catch (err) { await tx.rollback(); throw err; }
}

// ─── Q Note 세션 → 업무 후보 (cross-DB 브릿지, N+88) ───
// qnote 는 SQLite 라 Node 가 직접 못 읽음 → 프론트가 text(transcript/summary)+title+qnote_session_id 전달.
// 개인 노트라 프로젝트 미연결 기본 (담당자는 등록 시 사용자 선택). business_id 후보에 직접 저장 (tenant 격리).
async function extractNoteTaskCandidates({ text, title, qnoteSessionId, userId, businessId }) {
  const BusinessMember = require('../models/BusinessMember');
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return { candidates: [], reason: 'no_text' };

  const bms = await BusinessMember.findAll({ where: { business_id: businessId, removed_at: null }, include: [{ model: User, as: 'user', attributes: ['id', 'name'] }] });
  const memberNames = bms.map((m) => `- ${m.user?.name || 'unknown'} (role: ${m.role})`).join('\n');
  const note = `Q Note session "${title || ''}" (personal meeting/memo notes). Extract concrete deliverable-based tasks the note-taker needs to act on. Assignee is one of OUR team members above; default to the note-taker when ambiguous.`;

  const messagesText = clean.slice(0, 8000);
  const language = /[가-힣]/.test(messagesText) ? 'ko' : 'en';
  try { const usage = await checkUsageLimit(businessId); if (usage.over) return { candidates: [], skipped: 'usage_limit_exceeded' }; } catch { /* best-effort */ }

  const prompt = buildExtractionPrompt(messagesText, memberNames, language, note);
  const llmResult = await callLLMJson([{ role: 'system', content: prompt }], { temperature: 0.1, maxTokens: 1500 });
  await recordUsage(businessId, 'task_extraction', MODEL, llmResult.input_tokens, llmResult.output_tokens);

  let extracted = [];
  try { const parsed = JSON.parse(llmResult.content); extracted = Array.isArray(parsed.tasks) ? parsed.tasks : []; } catch { extracted = []; }
  extracted = extracted.filter((t) => String(t.title || '').trim());  // 빈 제목 후보 제거
  if (extracted.length === 0) return { candidates: [], reason: 'no_tasks_found', fallback: llmResult.fallback };

  // dedup — 같은 세션에서 이미 resolved 된 후보 제목 (qnote 는 source message id 없음 → title 기반)
  const resolvedC = await TaskCandidate.findAll({ where: { qnote_session_id: qnoteSessionId, status: { [Op.in]: ['registered', 'merged', 'rejected'] } }, attributes: ['title'] });
  const blockedTitles = new Set(resolvedC.map((c) => (c.title || '').trim().toLowerCase()));
  extracted = extracted.filter((t) => !blockedTitles.has(String(t.title || '').trim().toLowerCase()));
  if (extracted.length === 0) return { candidates: [], reason: 'all_duplicates' };

  const tx = await sequelize.transaction();
  try {
    const created = [];
    for (const c of extracted) {
      const rawDate = c.guessed_due_date; let safeDate = null;
      if (rawDate && typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())) {
        const d = new Date(rawDate.trim() + 'T00:00:00'); if (!isNaN(d.getTime())) safeDate = rawDate.trim();
      }
      const cand = await TaskCandidate.create({
        project_id: null, conversation_id: null, email_thread_id: null,
        qnote_session_id: qnoteSessionId, business_id: businessId,
        extracted_at: new Date(), extracted_by_user_id: userId,
        source_message_ids: null, source_email_message_ids: null,
        title: sanitizeTitle(c.title),
        description: c.description ? String(c.description).slice(0, 2000) : null,
        guessed_role: c.guessed_role ? String(c.guessed_role).slice(0, 50) : null,
        guessed_assignee_user_id: null,
        guessed_due_date: safeDate,
        similar_task_id: null,
        recurrence_hint: c.recurrence_hint || null,
        status: 'pending',
      }, { transaction: tx });
      created.push(cand);
    }
    await tx.commit();
    const result = [];
    for (const c of created) {
      const full = await TaskCandidate.findByPk(c.id, { include: [{ model: User, as: 'guessedAssignee', attributes: ['id', 'name'] }] });
      result.push(full.toJSON());
    }
    return { candidates: result, fallback: llmResult.fallback };
  } catch (err) { await tx.rollback(); throw err; }
}

// ─── 후보 → 정식 업무 등록 ───
// overrides: 우측 패널에서 사용자가 인라인 편집한 값 (title/assignee_id/due_date) 우선 적용.
// 30년차 시각: LLM 추측은 hint 일 뿐, 등록 시점에 사용자 결정이 source of truth.
async function registerCandidate(candidateId, userId, overrides = {}) {
  const candidate = await TaskCandidate.findByPk(candidateId);
  if (!candidate) throw new Error('candidate_not_found');
  if (candidate.status !== 'pending') throw new Error('candidate_already_resolved');

  const t = await sequelize.transaction();
  try {
    // business_id 해석 — 메일 스레드 / 프로젝트 / 대화 순. 메일이면 client_id 도 같이 (업무를 고객에 연결).
    let businessId = null;
    let emailClientId = null;
    if (candidate.email_thread_id) {
      const EmailThread = require('../models/EmailThread');
      const th = await EmailThread.findByPk(candidate.email_thread_id, { attributes: ['business_id', 'client_id'] });
      businessId = th?.business_id; emailClientId = th?.client_id || null;
    }
    if (!businessId && candidate.project_id) {
      businessId = (await Project.findByPk(candidate.project_id, { attributes: ['business_id'] })).business_id;
    }
    if (!businessId && candidate.conversation_id) {
      const conv = await Conversation.findByPk(candidate.conversation_id, { attributes: ['business_id'] });
      businessId = conv?.business_id;
    }
    // N+88 — Q Note 후보는 candidate.business_id 직접 사용 (cross-DB, linked 엔티티 없음)
    if (!businessId && candidate.qnote_session_id) businessId = candidate.business_id;
    if (!businessId) throw new Error('candidate_business_unresolved');

    // 사용자 편집값 우선. 미입력 시 LLM 추측, 그래도 없으면 fallback.
    const finalTitle = (overrides.title || candidate.title || '').trim();
    const finalDesc = overrides.description !== undefined ? overrides.description : candidate.description;
    // 담당자
    let finalAssignee;
    if (Object.prototype.hasOwnProperty.call(overrides, 'assignee_id')) {
      finalAssignee = overrides.assignee_id;
    } else {
      finalAssignee = candidate.guessed_assignee_user_id || userId;
    }

    // 🔒 담당자 배정 게이트 (D2-b #66) — 여태 tasks.js POST/PUT 에만 걸려 있고 이 승격 경로는
    //   통째로 우회했다. 실증: POST /api/tasks 로는 타 워크스페이스 사용자 배정이 403 인데,
    //   후보 등록으로는 200 → 외부 고객/타 워크스페이스 사람이 담당자가 되고(그 업무를 볼 수 있게 되고)
    //   알림까지 발송됐다(크로스테넌트 유출). 사람이 쓰는 문과 같은 문을 지나게 한다.
    if (finalAssignee && finalAssignee !== userId) {
      const { assertAssignable } = require('../middleware/access_scope');
      const chk = await assertAssignable(finalAssignee, businessId, candidate.project_id);
      if (!chk.ok) {
        // rollback 은 바깥 catch 가 한다 (여기서 또 부르면 이중 롤백 → 500)
        const err = new Error(`cannot_assign:${chk.reason}`);
        err.code = 'cannot_assign';
        throw err;
      }
    }

    // 🔒 Cue(AI)를 담당자로 승격 금지 — 등록 경로에는 executeForTask 트리거가 없어 아무도 실행하지
    //   않는 좀비 업무가 되고, 봇 계정에 알림이 나간다. 책임 주체는 사람 (project_ai_native_strategy).
    //   Cue 에게 맡기려면 업무를 만든 뒤 담당자를 Cue 로 지정한다 (그 경로엔 실행 트리거가 있다).
    if (finalAssignee) {
      const BusinessM = require('../models/Business');
      const bizRow = await BusinessM.findByPk(businessId, { attributes: ['cue_user_id'], transaction: t });
      if (bizRow?.cue_user_id && bizRow.cue_user_id === finalAssignee) {
        finalAssignee = userId;   // 등록한 사람이 책임 주체
      }
    }
    // 기간 (start_date / due_date) — 명시 override → 그 값 (null 허용) / 미전달 → guessed
    const finalStart = Object.prototype.hasOwnProperty.call(overrides, 'start_date')
      ? (overrides.start_date || null)
      : null;
    const finalDue = Object.prototype.hasOwnProperty.call(overrides, 'due_date')
      ? (overrides.due_date || null)
      : (candidate.guessed_due_date || null);

    // tasks 테이블에 삽입
    const task = await Task.create({
      business_id: businessId,
      project_id: candidate.project_id, // null 허용
      conversation_id: candidate.conversation_id,
      source_message_id: candidate.source_message_ids?.[0] || null,
      // 메일 스레드 후보 — 업무를 메일 스레드 + 고객에 연결 (Q Mail ↔ Q Task ↔ 타임라인 통합)
      ...(candidate.email_thread_id ? {
        email_thread_id: candidate.email_thread_id,
        source_email_message_id: candidate.source_email_message_ids?.[0] || null,
        client_id: emailClientId,
      } : {}),
      // N+88 — Q Note 후보 → 업무에 세션 역참조 (Q Note ↔ Q Task 브릿지)
      ...(candidate.qnote_session_id ? { qnote_session_id: candidate.qnote_session_id } : {}),
      title: finalTitle,
      description: finalDesc,
      assignee_id: finalAssignee,
      status: 'not_started',
      start_date: finalStart,
      due_date: finalDue,
      from_candidate_id: candidate.id,
      created_by: userId,
      // 요청 업무 모델 정렬 — 담당자가 등록자가 아니면 "내가 남에게 요청한 업무" 다.
      //   여태 이 경로만 source/request_by_user_id 를 안 채워서, 같은 업무가 등록 경로에 따라
      //   요청 업무로 보이기도 하고 아니기도 했다 (단건 POST · AI 확정 경로와 통일).
      ...(finalAssignee && Number(finalAssignee) !== Number(userId)
        ? { source: 'internal_request', request_by_user_id: userId }
        : {}),
    }, { transaction: t });

    // 요청 업무면 요청자를 컨펌자로 자동 등록 (컨펌 필수화 — 다른 두 경로와 같은 정책)
    if (finalAssignee && Number(finalAssignee) !== Number(userId)) {
      try {
        const { TaskReviewer } = require('../models');
        await TaskReviewer.findOrCreate({
          where: { task_id: task.id, user_id: userId },
          defaults: { task_id: task.id, user_id: userId, is_client: false, added_by_user_id: userId },
          transaction: t,
        });
      } catch (e) { console.warn('[registerCandidate auto-reviewer]', e.message); }
    }

    // 후보 상태 갱신
    await candidate.update({
      status: 'registered',
      registered_task_id: task.id,
      resolved_at: new Date(),
      resolved_by_user_id: userId,
    }, { transaction: t });

    await t.commit();

    // #90 — 후보 → 업무 승격 시 담당자 알림 (수동 생성 라우트 tasks.js 와 동일 정책).
    //  담당자 ≠ 등록자 일 때만 (본인이 본인에게 등록한 업무는 noise). 알림/링크 누락 회귀 차단.
    //  중첩 try/catch — 알림 실패가 이미 commit 된 등록 결과에 영향 주지 않도록.
    if (finalAssignee && finalAssignee !== userId) {
      try {
        const { notify } = require('../routes/notifications');
        const Business = require('../models/Business');
        const biz = await Business.findByPk(businessId, { attributes: ['name', 'brand_name'] });
        notify({
          userId: finalAssignee,
          businessId,
          eventKind: 'task',
          title: '새 업무가 배정되었습니다',
          body: `"${finalTitle}"${finalDue ? ` · 마감 ${String(finalDue).slice(0, 10)}` : ''}`,
          link: `${process.env.APP_URL || 'https://dev.planq.kr'}/tasks?task=${task.id}`,
          ctaLabel: '업무 보기',
          workspaceName: biz?.brand_name || biz?.name || null,
          actorUserId: userId,
          entityType: 'task',
          entityId: task.id,
          ioApp: global.__io || null,
        }).catch((e) => console.warn('[notify cue task assigned]', e.message));
      } catch (e) { console.warn('[notify cue task assigned outer]', e.message); }
    }

    return { candidate: candidate.toJSON(), task: task.toJSON() };
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

// ─── 후보 → 기존 업무에 병합 ───
async function mergeCandidate(candidateId, targetTaskId, userId) {
  const candidate = await TaskCandidate.findByPk(candidateId);
  if (!candidate) throw new Error('candidate_not_found');
  if (candidate.status !== 'pending') throw new Error('candidate_already_resolved');

  const targetTask = await Task.findByPk(targetTaskId);
  if (!targetTask) throw new Error('target_task_not_found');

  const t = await sequelize.transaction();
  try {
    // 기존 업무 description에 후보 내용 추가
    const separator = '\n\n---\n';
    const appendText = `[${new Date().toISOString().slice(0, 10)}] ${candidate.title}${candidate.description ? ': ' + candidate.description : ''}`;
    const newDesc = targetTask.description
      ? targetTask.description + separator + appendText
      : appendText;

    await targetTask.update({ description: newDesc }, { transaction: t });

    // 후보 상태 갱신
    await candidate.update({
      status: 'merged',
      registered_task_id: targetTask.id,
      resolved_at: new Date(),
      resolved_by_user_id: userId,
    }, { transaction: t });

    await t.commit();

    return { candidate: candidate.toJSON(), task: targetTask.toJSON() };
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

// ─── 후보 거절 ───
async function rejectCandidate(candidateId, userId) {
  const candidate = await TaskCandidate.findByPk(candidateId);
  if (!candidate) throw new Error('candidate_not_found');
  if (candidate.status !== 'pending') throw new Error('candidate_already_resolved');

  await candidate.update({
    status: 'rejected',
    resolved_at: new Date(),
    resolved_by_user_id: userId,
  });

  return candidate.toJSON();
}

module.exports = {
  extractTaskCandidates,
  extractEmailTaskCandidates,
  extractNoteTaskCandidates,
  registerCandidate,
  mergeCandidate,
  rejectCandidate,
  buildExtractionPrompt,  // 디버그·테스트용 노출
  buildAssigneePool,      // #90 디버그·테스트용 노출
  resolveAssignees,       // #90 디버그·테스트용 노출
};
