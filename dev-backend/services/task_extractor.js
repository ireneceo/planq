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
const { recordUsage, PRICING } = require('./cue_orchestrator');

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

// ─── 프롬프트 ───
function buildExtractionPrompt(messagesText, memberNames, language) {
  const lang = language === 'en' ? 'English' : 'Korean';
  return `You are a task extraction assistant. Analyze the chat messages below and identify actionable tasks.

CRITICAL NAMING RULE:
- Every task title MUST describe a concrete deliverable + an action verb in its BASE form.
- BAD (vague, no deliverable): "시장조사", "디자인 작업", "검토", "준비"
- BAD (completion suffix — looks already done): "~ 제작 완료", "~ 작성 완료", "~ 완성", "~ 마무리"
- GOOD (deliverable + base verb): "경쟁사 비교분석표 작성", "로고 시안 3종 PDF 제작", "견적서 작성·전달", "Lighthouse 성능 감사 보고서 작성"
- The title should answer: "What artifact/document/file is produced?" — NOT "it was done".
- NEVER append "완료", "완성", "마무리", "done", "finished" to titles. Completion is tracked in the status field, not the title.

RULES:
1. Only extract clear, actionable tasks (NOT questions, NOT greetings, NOT general discussion)
2. Each task must have a concrete deliverable — a document, file, report, or measurable outcome
3. If someone says "can you do X" or "please handle Y" or "we need Z done", that's a task
4. If a deadline is mentioned or implied, include it as guessed_due_date (YYYY-MM-DD format)
5. guessed_role should match one of the team member roles if identifiable from context
6. Write title and description in ${lang}

TEAM MEMBERS:
${memberNames}

Respond in JSON format:
{"tasks": [{"title": "...", "description": "...", "guessed_role": "...", "guessed_due_date": "YYYY-MM-DD or null", "source_message_ids": [msg_id, ...]}]}

Return empty array if no actionable tasks found: {"tasks": []}

MESSAGES:
${messagesText}`;
}

// ─── 역할 → 멤버 매칭 ───
async function resolveAssignees(candidates, projectId) {
  const members = await ProjectMember.findAll({
    where: { project_id: projectId },
    include: [{ model: User, attributes: ['id', 'name'] }],
  });

  // 프로젝트 default_assignee 조회
  const project = await Project.findByPk(projectId, { attributes: ['default_assignee_user_id'] });
  const defaultAssignee = project?.default_assignee_user_id || null;

  return candidates.map((c) => {
    let assigneeId = null;

    if (c.guessed_role) {
      const roleLower = String(c.guessed_role).toLowerCase().trim();
      // 1차: role 정확 매칭
      const exact = members.find((m) => String(m.role).toLowerCase().trim() === roleLower);
      if (exact) {
        assigneeId = exact.user_id;
      } else {
        // 2차: role 부분 매칭 (포함 관계)
        const partial = members.find((m) => {
          const mr = String(m.role).toLowerCase().trim();
          return mr.includes(roleLower) || roleLower.includes(mr);
        });
        if (partial) assigneeId = partial.user_id;
      }
    }

    // 3차: 매칭 실패 시 default_assignee fallback
    if (!assigneeId && defaultAssignee) {
      assigneeId = defaultAssignee;
    }

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

    // 언어 감지 (간이: 한글 포함 여부)
    const hasKorean = /[가-힣]/.test(messagesText);
    const language = hasKorean ? 'ko' : 'en';

    // LLM 호출
    const prompt = buildExtractionPrompt(messagesText, memberNames, language);
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
          guessed_due_date: c.guessed_due_date || null,
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
async function registerCandidate(candidateId, userId) {
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

    // tasks 테이블에 삽입
    const task = await Task.create({
      business_id: businessId,
      project_id: candidate.project_id, // null 허용
      conversation_id: candidate.conversation_id,
      source_message_id: candidate.source_message_ids?.[0] || null,
      title: candidate.title,
      description: candidate.description,
      assignee_id: candidate.guessed_assignee_user_id,
      status: 'not_started',
      due_date: candidate.guessed_due_date,
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
};
