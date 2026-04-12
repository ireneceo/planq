"""
LLM service — translation, question detection, summary, answer generation.

LLM_PROVIDER 환경변수로 제공자 교체 가능 (현재 openai만 지원).
모델 교체 시 LLM_MODEL 변경.

All public functions accept an optional `meeting_context` dict with:
  - brief: str (회의 안내)
  - participants: list[{name, role}]
  - pasted_context: str (붙여넣은 참고 텍스트)
Any present field is prepended to the system prompt as context prefix.
"""
import os
import json
import logging
from typing import Optional, Any
from openai import AsyncOpenAI

logger = logging.getLogger('q-note.llm')

LLM_PROVIDER = os.getenv('LLM_PROVIDER', 'openai')
LLM_MODEL = os.getenv('LLM_MODEL', 'gpt-4.1-nano')           # 실시간 정제 (속도 우선)
LLM_MODEL_ANSWER = os.getenv('LLM_MODEL_ANSWER', 'gpt-4o-mini')  # 답변 생성 (품질 우선)
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY', '')

_client: Optional[AsyncOpenAI] = None


def get_client() -> AsyncOpenAI:
  global _client
  if _client is None:
    if not OPENAI_API_KEY:
      raise RuntimeError('OPENAI_API_KEY not configured')
    _client = AsyncOpenAI(api_key=OPENAI_API_KEY)
  return _client


# ─────────────────────────────────────────────────────────
# Meeting context prefix
# ─────────────────────────────────────────────────────────

def _build_context_prefix(meeting_context: Optional[dict]) -> str:
  """Format optional meeting context + user profile as a prefix block."""
  if not meeting_context:
    return ''
  parts = []

  # 사용자 프로필 — "나"로서 답변하기 위한 배경
  profile = meeting_context.get('user_profile')
  if profile and isinstance(profile, dict):
    lines = []
    name = profile.get('name')
    if name:
      lines.append(f'- Name: {name}')
    if profile.get('job_title'):
      lines.append(f'- Job Title: {profile["job_title"]}')
    if profile.get('organization'):
      lines.append(f'- Organization: {profile["organization"]}')
    if profile.get('expertise'):
      lines.append(f'- Expertise: {profile["expertise"]}')
    if profile.get('bio'):
      lines.append(f'- Background: {profile["bio"]}')
    if lines:
      parts.append('## Your Profile (You are this person — answer AS them, not as an AI)\n' + '\n'.join(lines))

  brief = meeting_context.get('brief')
  if brief:
    parts.append(f'## Meeting Brief\n{brief.strip()}')

  participants = meeting_context.get('participants')
  if participants and isinstance(participants, list):
    lines = []
    for p in participants:
      if not isinstance(p, dict):
        continue
      pname = p.get('name', '').strip()
      role = (p.get('role') or '').strip()
      if not pname:
        continue
      lines.append(f'- {pname}' + (f' ({role})' if role else ''))
    if lines:
      parts.append('## Other Meeting Participants\n' + '\n'.join(lines))

  pasted = meeting_context.get('pasted_context')
  if pasted:
    snippet = pasted.strip()[:4000]
    parts.append(f'## Reference Notes\n{snippet}')

  if not parts:
    return ''
  return '\n\n'.join(parts) + '\n\n---\n\n'


# ─────────────────────────────────────────────────────────
# Translation + Question Detection — 언어별 완전 프롬프트
# ─────────────────────────────────────────────────────────
#
# 구조: 언어별로 포맷팅 + 번역 + 질문 판정 규칙을 모두 포함하는 자기완결 프롬프트.
# 회의 언어를 선택하면 해당 언어의 프롬프트가 사용됨.
# 새 언어 지원 = 해당 언어의 프롬프트를 추가하기만 하면 됨.

SYSTEM_KO = """당신은 실시간 회의 어시스턴트입니다. 음성인식(STT) 출력을 정제합니다.
입력은 실시간 음성 인식기에서 온 한국어 텍스트이며 다음 문제가 있을 수 있습니다:
  - 띄어쓰기 누락/오류 (단어가 붙어 나옴)
  - 구두점 누락 (마침표, 쉼표, 물음표 없음)
  - 발음이 비슷한 다른 단어로 잘못 인식 (고유명사, 인명, 전문용어)
  - 억양 때문에 평서문에 "?"가 붙는 STT 오류

발화 하나를 받아 아래 4개 필드를 JSON으로 응답하세요.

## 1. formatted_original (한국어 정제)

한국어 맞춤법/띄어쓰기 규칙:
  - 조사는 앞말에 붙여 씀: "나는", "회의를", "오늘의"
  - 의존명사는 띄어 씀: "할 수 있다", "할 때", "하는 것"
  - 보조용언은 띄어 씀: "해 보다", "하고 있다", "할 수 있다"
  - 고유명사는 대문자/원형 유지: "PlanQ", "Google Meet"
  - 숫자+단위: "3시", "10분", "5명"

구두점 규칙:
  - 문장 끝에 마침표(.), 물음표(?), 느낌표(!) 추가
  - 나열/전환에 쉼표(,) 추가
  - 물음표는 실제 질문일 때만. 억양 때문에 올라간 평서문에는 마침표(.)

단어 교정 (매우 보수적으로):
  - 교정 대상: 회의 참여자 이름, 회사명, 제품명 등 고유명사가 STT에서 발음 유사한 다른 단어로 잘못 인식된 경우만
  - 교정 금지: 일반 단어 변경, 문장 구조 변경, 어순 변경, 단어 추가/삭제, 의역
  - 화자가 실제로 한 말을 그대로 보존. 어색하거나 문법이 틀려도 고치지 않음
  - 띄어쓰기와 구두점만 수정하고 단어 자체는 건드리지 않는 것이 기본 원칙

## 2. translation (영어 번역)

  - formatted_original을 자연스러운 영어로 번역
  - 교정된 고유명사를 그대로 사용
  - 존댓말 → formal, 반말 → casual 유지
  - 의역하지 말고 의미에 충실하게

## 3. is_question (질문 판정) — 기본값 false

**true 조건** (모두 충족해야 함):
  1. 화자가 답을 모르고
  2. 상대방에게 구체적 정보를 요청하며
  3. 의문사(뭐/어디/언제/왜/어떻게/누구/얼마) + 의문 어미 구조

true 예시:
  - "이 기능은 어떻게 작동해요?" — 기능 설명을 모르고 물어봄
  - "마감이 언제까지예요?" — 마감일을 모르고 물어봄
  - "예산이 얼마나 남았나요?" — 예산 정보를 요청
  - "누가 담당이에요?" — 담당자를 모르고 물어봄
  - "그 파일 어디 있어요?" — 파일 위치를 물어봄
  - "진행 상황이 어떻게 돼요?" — 상황 보고를 요청

**false 패턴** (하나라도 해당하면 무조건 false):

  어미 기반 (이 어미로 끝나면 false):
  - ~지? ~잖아? ~거든? ~거야? → 확인/동의 ("알겠지?", "맞잖아?", "그거든?")
  - ~할까? ~할까요? ~해볼까? → 의향/제안 ("시작할까요?", "해볼까?")
  - ~하면? ~한다면? ~라면? ~으면? → 조건/가정 ("내가 정리하면?", "그렇다면?")
  - ~해 줘 ~해주세요 ~부탁해요 ~드려요 → 요청/명령 ("확인해 줘", "보내주세요")
  - ~할 수 있나요? ~해주실 수 있나요? ~될까요? → 공손한 요청 (질문 아님)
  - ~겠다 ~좋겠다 ~좋겠어 ~하겠네 → 감탄/희망/추측
  - ~인데 ~거든 ~는데요 → 문장 중간 종결 (미완성 발화)

  내용 기반:
  - 자기소개/인사: "안녕하세요", "저는 ○○입니다/예요", "반갑습니다", "잘 부탁합니다"
  - 수사적 질문 (화자가 이미 답을 암): "왜 자꾸 그래?", "이게 말이 돼?", "누가 그래?"
  - 독백/감탄: "뭐지?", "그런가?", "진짜?", "그래?", "설마?"
  - 질문 예고: "질문 드리고 싶은데", "여쭤봐도 될까요?", "한 가지 궁금한 게"
  - 되묻기/반응: "네?", "뭐라고요?", "정말요?"
  - 혼잣말: "이거 왜 이러지?", "어디 갔지?", "뭐였더라?"

  STT 오류 대응:
  - 평서문인데 억양 때문에 "?"가 붙은 경우 → 문맥으로 판단. 정보 요청 의도 없으면 false
  - "저는 루아예요?" → 자기소개. false
  - "오늘 날씨 좋네요?" → 감탄. false

  **의심되면 false. 오판(false positive)이 누락(false negative)보다 훨씬 나쁨.**

## 4. detected_language

  "ko" 고정 (한국어 세션)

응답 형식 (strict JSON만, 설명 없이):
{"formatted_original": "...", "translation": "...", "is_question": true|false, "detected_language": "ko"}
"""


SYSTEM_EN = """You are a real-time meeting assistant that cleans up speech-to-text output.
The input is English text from a live speech recognizer and may contain:
  - Missing or incorrect punctuation (no periods, commas, question marks)
  - Missing capitalization (sentence starts, proper nouns)
  - Phonetically plausible but contextually wrong words (mis-recognized names, technical terms)
  - Rising intonation causing STT to add "?" to statements

Given one utterance, respond with exactly 4 fields in JSON.

## 1. formatted_original (English cleanup)

Punctuation rules:
  - End sentences with period (.), question mark (?), or exclamation mark (!)
  - Add commas for lists, pauses, subordinate clauses
  - Question marks ONLY for genuine questions — NOT for statements with rising intonation
  - Capitalize sentence starts, proper nouns, acronyms

Word correction (very conservative):
  - ONLY correct proper nouns (participant names, company names, product names) that STT mis-recognized as phonetically similar words
  - NEVER change ordinary words, sentence structure, word order, or add/remove words
  - Preserve exactly what the speaker said, even if awkward or grammatically incorrect
  - Default: fix only spacing and punctuation, leave words untouched

## 2. translation (Korean translation)

  - Translate formatted_original to natural Korean
  - Use corrected proper nouns as-is
  - Match formality: formal English → 존댓말, casual → 반말
  - Faithful to meaning, not word-for-word

## 3. is_question — default is false

**true** (ALL conditions must be met):
  1. The speaker does NOT know the answer
  2. They are requesting specific information from someone else
  3. Proper interrogative structure (Wh-word + aux inversion, or yes/no inversion)

true examples:
  - "What is the timeline for this project?" — requests unknown schedule info
  - "How does this feature work?" — requests explanation
  - "Where is the design file?" — requests location
  - "Is the build passing?" — requests status info
  - "Did we get the client's approval?" — requests confirmation of unknown fact
  - "Who is handling the deployment?" — requests person info

**false patterns** (if ANY applies → false):

  Syntax-based (false regardless of "?"):
  - Requests/commands: "Could you send that?", "Can you check this?", "Would you mind reviewing?", "Please update the doc", "Let me know when you're done"
  - Tag questions: "..., right?", "..., don't you think?", "..., isn't it?", "..., yeah?"
  - Rhetorical: "Isn't that obvious?", "Who would do that?", "How hard can it be?", "Why would we?"
  - Suggestions: "How about we try X?", "What if we do Y?", "Why don't we...", "Shall we..."
  - Embedded questions: "I wonder if...", "I'm not sure whether...", "Let me check if..."
  - Incomplete questions: "What about..." (without clear info request), "And then?"

  Content-based:
  - Greetings/intros: "Hi, I'm Lua", "Nice to meet you", "Good morning everyone"
  - Thinking aloud: "Maybe we should...", "I think we could...", "Let's see..."
  - Reactions/exclamations: "Really?", "Seriously?", "No way?", "Oh yeah?"
  - Filler/echo: "Right?", "You know?", "Okay?", "Huh?"
  - Self-directed: "Where did I put that?", "What was I saying?"

  STT intonation errors:
  - Statement with rising intonation → "?" added by STT → judge by MEANING, not punctuation
  - "I'm working on the report?" → statement. false
  - "We should be done by Friday?" → statement. false

  **When in doubt, mark false. A false positive (non-question shown as question card) is far worse than a missed question.**

## 4. detected_language

  "en" fixed (English session)

Response format (strict JSON only, no explanation):
{"formatted_original": "...", "translation": "...", "is_question": true|false, "detected_language": "en"}
"""


# ── 기본 (multi 또는 미지원 언어) ──

SYSTEM_DEFAULT = """You are a real-time meeting assistant that cleans up speech-to-text output.

Given one utterance, respond with 4 JSON fields:

1. **formatted_original** — cleaned-up text: fix spacing, add punctuation, correct obvious mis-recognitions using meeting context. Preserve meaning/tone.
2. **translation** — translate to the counterpart language (Korean↔English). Mixed → counterpart of dominant language.
3. **is_question** — true ONLY if the speaker is asking for specific information they don't know. Default false. Requests, commands, rhetorical questions, suggestions, confirmations, greetings = false. When in doubt, false.
4. **detected_language** — "ko", "en", or "mixed"

Response format (strict JSON only):
{"formatted_original": "...", "translation": "...", "is_question": true|false, "detected_language": "..."}
"""

# 언어 코드 → 프롬프트 매핑
_SYSTEM_MAP: dict[str, str] = {
  'ko': SYSTEM_KO,
  'en': SYSTEM_EN,
  'en-US': SYSTEM_EN,
  'en-GB': SYSTEM_EN,
}


def _build_translate_system(language: Optional[str] = None) -> str:
  """회의 언어에 맞는 전용 프롬프트 반환."""
  return _SYSTEM_MAP.get(language or '', SYSTEM_DEFAULT)


async def translate_and_detect_question(
  text: str,
  meeting_context: Optional[dict] = None,
  language: Optional[str] = None,
) -> dict:
  """
  Returns: {"formatted_original": str, "translation": str, "is_question": bool, "detected_language": str}
  language: 세션의 meeting_language (ko, en 등). 해당 언어의 질문 판정 규칙 적용.
  """
  if not text or not text.strip():
    return {'formatted_original': text, 'translation': '', 'is_question': False, 'detected_language': 'unknown'}

  try:
    client = get_client()
    system_content = _build_context_prefix(meeting_context) + _build_translate_system(language)
    response = await client.chat.completions.create(
      model=LLM_MODEL,
      messages=[
        {'role': 'system', 'content': system_content},
        {'role': 'user', 'content': text},
      ],
      response_format={'type': 'json_object'},
      max_completion_tokens=300,
    )
    content = response.choices[0].message.content
    data = json.loads(content)
    return {
      'formatted_original': data.get('formatted_original', text),
      'translation': data.get('translation', ''),
      'is_question': bool(data.get('is_question', False)),
      'detected_language': data.get('detected_language', 'unknown'),
    }
  except Exception as e:
    logger.error(f'translate_and_detect_question failed: {e}')
    return {
      'formatted_original': text,
      'translation': '',
      'is_question': False,
      'detected_language': 'error',
      'error': str(e),
    }


# ─────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────

SUMMARY_SYSTEM = """You are a meeting summarizer.
Given a meeting transcript, produce:
1. key_points: array of 3-7 short bullet strings (action items, decisions, key facts)
2. full_summary: a 2-4 paragraph narrative summary

Match the language of the transcript (Korean → Korean output, English → English output, mixed → use the dominant language).

Respond ONLY with strict JSON:
{"key_points": ["..."], "full_summary": "..."}
"""


async def generate_summary(transcript: str, meeting_context: Optional[dict] = None) -> dict:
  """Returns: {"key_points": list[str], "full_summary": str}"""
  if not transcript.strip():
    return {'key_points': [], 'full_summary': ''}

  client = get_client()
  system_content = _build_context_prefix(meeting_context) + SUMMARY_SYSTEM
  response = await client.chat.completions.create(
    model=LLM_MODEL_ANSWER,
    messages=[
      {'role': 'system', 'content': system_content},
      {'role': 'user', 'content': transcript},
    ],
    response_format={'type': 'json_object'},
    max_completion_tokens=2000,
  )
  data = json.loads(response.choices[0].message.content)
  return {
    'key_points': data.get('key_points', []),
    'full_summary': data.get('full_summary', ''),
  }


# ─────────────────────────────────────────────────────────
# Answer generation (RAG, B-5)
# ─────────────────────────────────────────────────────────

ANSWER_SYSTEM_RAG = """You are preparing an answer that the user (described in "Your Profile" above) will speak in their meeting.

**CRITICAL: You are NOT an AI assistant. You ARE the person described in the profile.**
Speak in first person as that person. Use "I", "my", "we" naturally.
Never say "As an AI", "I don't have personal preferences", "I'm here to help". You are a real human answering.

Rules:
1. Answer in {answer_lang_name}, in first person, as the profile's person.
2. Use the document excerpts below to ground your answer when they're relevant to the question.
3. Match the person's tone — if they're an expert in X, speak with that authority. If they run a company, speak from that position.
4. For conversational questions ("How are you?", "What do you like?"), answer as the person would — based on their bio, role, interests.
5. Include concrete details from the context (numbers, names, dates) when they answer the question.
6. Only say "자료에서 답을 찾지 못했습니다" if the question clearly requires specific document content AND the context has nothing relevant.
7. Structure longer answers with line breaks for readability.

Confidence:
- "high" — answer grounded in context or profile
- "medium" — reasonable inference from profile/context
- "low" — speculative

Respond ONLY with strict JSON:
{{"answer": "...", "confidence": "high"|"medium"|"low"}}
"""

ANSWER_SYSTEM_GENERAL = """You are preparing an answer that the user (described in "Your Profile" above) will speak in their meeting.

**CRITICAL: You are NOT an AI assistant. You ARE the person described in the profile.**
Speak in first person as that person. Use "I", "my", "we" naturally.
Never say "As an AI", "I don't have personal preferences", "I'm here to help", or anything that breaks the first-person persona. You are a real human answering.

Rules:
1. Answer in {answer_lang_name}, in first person, as the profile's person.
2. Base your answer on the profile — the person's role, expertise, organization, background.
3. For factual questions, use general knowledge as that person would know it.
4. For conversational questions ("What do you like?", "How are you?"), answer naturally based on the profile — not generically.
5. If asked about something the person couldn't plausibly know (e.g., internal company info not in profile), say so briefly as that person would ("I'd need to check with the team on that").
6. Be specific and personal. Avoid generic "I appreciate a wide range of topics" type answers.

Respond ONLY with strict JSON:
{{"answer": "...", "confidence": "high"|"medium"|"low"}}
"""


# ── 언어 코드 → 사람이 읽는 이름 ──
_LANG_NAMES = {
  'ko': 'Korean', 'en': 'English', 'en-US': 'English', 'en-GB': 'English',
  'ja': 'Japanese', 'zh': 'Chinese', 'es': 'Spanish', 'fr': 'French',
  'de': 'German', 'pt': 'Portuguese', 'vi': 'Vietnamese', 'th': 'Thai',
}


def _lang_name(code: Optional[str]) -> str:
  if not code:
    return 'the same language as the question'
  return _LANG_NAMES.get(code, code)


async def generate_answer(
  question: str,
  context_chunks: list,
  meeting_context: Optional[dict] = None,
  answer_language: Optional[str] = None,
) -> dict:
  """
  답변 생성 (번역 없음 — 속도 우선).
  context_chunks 유무에 따라 RAG vs general 프롬프트 분기.
  Returns: {"answer": str, "confidence": str}
  """
  ans_lang = answer_language or 'the same language as the question'
  ans_lang_name = _lang_name(ans_lang) if ans_lang != 'the same language as the question' else ans_lang

  if context_chunks:
    # RAG 모드: 자료 있음
    context = '\n\n---\n\n'.join(context_chunks)
    user_msg = f'Context:\n{context}\n\nQuestion: {question}'
    system_prompt = ANSWER_SYSTEM_RAG.replace('{answer_lang_name}', ans_lang_name)
  else:
    # General 모드: 자료 없음 — 일반 지식으로 답변
    user_msg = f'Question: {question}'
    system_prompt = ANSWER_SYSTEM_GENERAL.replace('{answer_lang_name}', ans_lang_name)

  client = get_client()
  system_content = _build_context_prefix(meeting_context) + system_prompt
  try:
    response = await client.chat.completions.create(
      model=LLM_MODEL_ANSWER,
      messages=[
        {'role': 'system', 'content': system_content},
        {'role': 'user', 'content': user_msg},
      ],
      response_format={'type': 'json_object'},
      max_completion_tokens=1000,
    )
    data = json.loads(response.choices[0].message.content)
    return {
      'answer': data.get('answer', ''),
      'confidence': data.get('confidence', 'low'),
    }
  except Exception as e:
    logger.error(f'generate_answer failed: {e}')
    return {'answer': '', 'confidence': 'low', 'error': str(e)}


async def translate_text(text: str, target_language: str) -> str:
  """
  단순 번역. 답변 텍스트를 대상 언어로 번역.
  실시간 정제(gpt-4.1-nano)로 빠르게 처리.
  """
  if not text or not text.strip():
    return ''
  target_name = _lang_name(target_language)
  client = get_client()
  try:
    response = await client.chat.completions.create(
      model=LLM_MODEL,  # gpt-4.1-nano — 속도 우선
      messages=[
        {'role': 'system', 'content': f'Translate the following text to {target_name}. Output ONLY the translation, nothing else.'},
        {'role': 'user', 'content': text},
      ],
      max_completion_tokens=500,
    )
    return (response.choices[0].message.content or '').strip()
  except Exception as e:
    logger.error(f'translate_text failed: {e}')
    return ''


# ─────────────────────────────────────────────────────────
# Q&A Generation from documents
# ─────────────────────────────────────────────────────────

QA_GENERATION_SYSTEM = """You are analyzing a document to generate likely Q&A pairs for meeting preparation.

Given document content, generate questions that someone (professor, client, audience) might ask.
Focus on:
- Key claims and their evidence
- Methodology, approach, and rationale
- Definitions and core concepts
- Practical implications and applications
- Potential weaknesses, limitations, or counterarguments

Rules:
1. Generate 8-15 Q&A pairs.
2. Answer in {answer_lang_name}.
3. Each answer must include ALL relevant details from the document — specific numbers, names, dates, methods, and reasoning. Do NOT summarize into one sentence. Write a full, useful answer that someone could read aloud in a presentation.
4. Categorize each pair (e.g. "Background", "Methodology", "Key Findings", "Limitations", etc.)
5. Rate confidence: "high" if directly stated in document, "medium" if inferred, "low" if speculative.

Respond ONLY with strict JSON:
{{
  "qa_pairs": [
    {{
      "question": "...",
      "answer": "...",
      "category": "...",
      "confidence": "high"|"medium"|"low"
    }}
  ]
}}
"""


async def generate_qa_from_chunks(
  chunks: list[str],
  meeting_context: Optional[dict] = None,
  answer_language: Optional[str] = None,
  translation_language: Optional[str] = None,
) -> list[dict]:
  """
  문서 청크에서 예상 Q&A 쌍을 생성.
  Returns: [{"question": str, "answer": str, "answer_translation": str, "category": str, "confidence": str}]
  """
  if not chunks:
    return []

  # 토큰 예산: ~12000자 (약 4000토큰)
  combined = '\n\n---\n\n'.join(chunks)
  if len(combined) > 12000:
    combined = combined[:12000] + '\n\n[... truncated]'

  ans_lang = answer_language or 'the same language as the document'
  trans_lang = translation_language or ('English' if ans_lang == 'ko' else 'Korean')
  ans_lang_name = _lang_name(ans_lang) if ans_lang != 'the same language as the document' else ans_lang
  trans_lang_name = _lang_name(trans_lang)

  system_prompt = QA_GENERATION_SYSTEM.replace('{answer_lang_name}', ans_lang_name).replace('{translation_lang_name}', trans_lang_name)

  client = get_client()
  system_content = _build_context_prefix(meeting_context) + system_prompt
  try:
    response = await client.chat.completions.create(
      model=LLM_MODEL_ANSWER,
      messages=[
        {'role': 'system', 'content': system_content},
        {'role': 'user', 'content': f'Document content:\n{combined}'},
      ],
      response_format={'type': 'json_object'},
      max_completion_tokens=4000,
    )
    data = json.loads(response.choices[0].message.content)
    return data.get('qa_pairs', [])
  except Exception as e:
    logger.error(f'generate_qa_from_chunks failed: {e}')
    return []
