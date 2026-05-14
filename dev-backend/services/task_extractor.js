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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = 'gpt-4o-mini';
const MAX_MESSAGES = 50;

// ─── LLM 호출 (JSON 모드) ───
async function callLLMJson(messages, opts = {}) {
  if (!OPENAI_API_KEY) {
    return { content: '[]', input_tokens: 0, output_tokens: 0, fallback: true };
  }
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: opts.temperature ?? 0.1,
        max_tokens: opts.maxTokens || 1500,
        response_format: { type: 'json_object' }
      })
    });
    if (!r.ok) {
      const err = await r.text();
      console.warn('[task_extractor] LLM error', r.status, err.slice(0, 200));
      return { content: '{"tasks":[]}', input_tokens: 0, output_tokens: 0, fallback: true };
    }
    const data = await r.json();
    return {
      content: data.choices?.[0]?.message?.content || '{"tasks":[]}',
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
      fallback: false
    };
  } catch (err) {
    console.warn('[task_extractor] LLM exception', err.message);
    return { content: '{"tasks":[]}', input_tokens: 0, output_tokens: 0, fallback: true };
  }
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

// ─── 이름/역할 → 멤버 매칭 (LLM 출력의 guessed_assignee_name / guessed_role 우선순위) ───
// 30년차 시각: LLM 이 빈 후보를 채우려고 default_assignee 강제 부여하면 사용자에게 잘못된 추측을 강요.
// 보수적: 이름·역할 매칭 실패하면 null 반환 (사용자가 우측 패널에서 직접 지정).
async function resolveAssignees(candidates, projectId) {
  const members = await ProjectMember.findAll({
    where: { project_id: projectId },
    include: [{ model: User, attributes: ['id', 'name'] }],
  });

  return candidates.map((c) => {
    let assigneeId = null;

    // 1차: 이름 직접 매칭 (LLM 이 "한수정" 같은 이름 명시)
    if (c.guessed_assignee_name) {
      const nameNorm = String(c.guessed_assignee_name).trim();
      const byName = members.find((m) => m.User?.name && String(m.User.name).trim() === nameNorm);
      if (byName) assigneeId = byName.user_id;
    }

    // 2차: role 매칭
    if (!assigneeId && c.guessed_role) {
      const roleLower = String(c.guessed_role).toLowerCase().trim();
      const exact = members.find((m) => String(m.role).toLowerCase().trim() === roleLower);
      if (exact) {
        assigneeId = exact.user_id;
      } else {
        const partial = members.find((m) => {
          const mr = String(m.role).toLowerCase().trim();
          return mr.includes(roleLower) || roleLower.includes(mr);
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

    // 메시지 텍스트 구성
    const messagesText = msgs.map((m) => {
      const name = m.sender?.name || `user_${m.sender_id}`;
      return `[msg_id:${m.id}] ${name}: ${m.content}`;
    }).join('\n');

    // 프로젝트 멤버 이름+역할 목록 (standalone 은 빈 문자열)
    let memberNames = '';
    if (conversation.project_id) {
      const members = await ProjectMember.findAll({
        where: { project_id: conversation.project_id },
        include: [{ model: User, attributes: ['id', 'name'] }],
      });
      memberNames = members.map((m) => `- ${m.User?.name || 'unknown'} (role: ${m.role})`).join('\n');
    }

    // 대화 참여자 목록 (담당자 추론 룰: 1:1 채팅에서 상대 자동 지정용)
    let conversationParticipantNames = '';
    try {
      const ConversationParticipant = require('../models/ConversationParticipant');
      const parts = await ConversationParticipant.findAll({
        where: { conversation_id: conversationId },
        include: [{ model: User, attributes: ['id', 'name'] }],
      });
      const participantsList = parts.filter(p => p.User).map(p => `- ${p.User.name} (user_id: ${p.User.id})`).join('\n');
      const totalCount = parts.length;
      conversationParticipantNames = `Total participants: ${totalCount}\n${participantsList}\nNote: ${totalCount === 2 ? 'This is a 1-on-1 chat — when sender asks the other person to do X, that person is the assignee.' : 'Group chat — only assign when explicitly named.'}`;
    } catch { /* fallback empty */ }

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

    // 역할 → 담당자 매칭 / 유사 업무 탐색 — standalone 이면 프로젝트 컨텍스트 없으므로 스킵
    let withSimilar = extracted;
    if (conversation.project_id) {
      const withAssignees = await resolveAssignees(extracted, conversation.project_id);
      withSimilar = await findSimilarTasks(withAssignees, conversation.project_id);
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
          title: String(c.title || '').slice(0, 300),
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

// ─── 후보 → 정식 업무 등록 ───
// overrides: 우측 패널에서 사용자가 인라인 편집한 값 (title/assignee_id/due_date) 우선 적용.
// 30년차 시각: LLM 추측은 hint 일 뿐, 등록 시점에 사용자 결정이 source of truth.
async function registerCandidate(candidateId, userId, overrides = {}) {
  const candidate = await TaskCandidate.findByPk(candidateId);
  if (!candidate) throw new Error('candidate_not_found');
  if (candidate.status !== 'pending') throw new Error('candidate_already_resolved');

  const t = await sequelize.transaction();
  try {
    // business_id 는 프로젝트 우선, standalone 이면 대화에서 조회
    let businessId = null;
    if (candidate.project_id) {
      businessId = (await Project.findByPk(candidate.project_id, { attributes: ['business_id'] })).business_id;
    } else if (candidate.conversation_id) {
      const conv = await Conversation.findByPk(candidate.conversation_id, { attributes: ['business_id'] });
      businessId = conv?.business_id;
    }
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
      title: finalTitle,
      description: finalDesc,
      assignee_id: finalAssignee,
      status: 'not_started',
      start_date: finalStart,
      due_date: finalDue,
      from_candidate_id: candidate.id,
      created_by: userId,
    }, { transaction: t });

    // 후보 상태 갱신
    await candidate.update({
      status: 'registered',
      registered_task_id: task.id,
      resolved_at: new Date(),
      resolved_by_user_id: userId,
    }, { transaction: t });

    await t.commit();

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
  registerCandidate,
  mergeCandidate,
  rejectCandidate,
  buildExtractionPrompt,  // 디버그·테스트용 노출
};
