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
# Answer style prefix — 언어 레벨, 답변 길이, 회의별 스타일
# ─────────────────────────────────────────────────────────

_LEVEL_LABELS = {
  1: 'Beginner (CEFR A1)',
  2: 'Elementary (CEFR A2)',
  3: 'Intermediate (CEFR B1)',
  4: 'Upper Intermediate (CEFR B2)',
  5: 'Advanced (CEFR C1)',
  6: 'Native / Proficient (C2)',
}

_LENGTH_INSTRUCTIONS = {
  'short': (
    '1-2 SENTENCES ONLY. STRICT MAX 25 WORDS. '
    'One key point. No examples, no elaboration. '
    'If you write 3 sentences or 26+ words, you have failed.'
  ),
  'medium': (
    '2-3 SENTENCES ONLY. STRICT MAX 50 WORDS. '
    'One key point + one brief supporting detail. '
    'If you write 4 sentences or 51+ words, you have failed.'
  ),
  'long': (
    '3-4 SENTENCES ONLY. STRICT MAX 80 WORDS. '
    'One key point, reasoning, and optionally one brief example. '
    'If you write 5 sentences or 81+ words, you have failed.'
  ),
}


def _level_label(n: Optional[int]) -> str:
  if not n:
    return ''
  try:
    n = int(n)
  except (TypeError, ValueError):
    return ''
  return _LEVEL_LABELS.get(max(1, min(6, n)), '')


def _build_answer_style_prefix(
  answer_language: Optional[str],
  language_levels: Optional[dict],
  expertise_level: Optional[str],
  meeting_style: Optional[str],
  meeting_length: Optional[str],
) -> str:
  """답변 생성용 스타일/난이도/길이 규칙 블록."""
  lines = ['## Answer Style Rules — CRITICAL, obey exactly']

  # 답변 길이
  length_rule = _LENGTH_INSTRUCTIONS.get(meeting_length or 'medium', _LENGTH_INSTRUCTIONS['medium'])
  lines.append(f'### Length\n{length_rule}')

  # 언어 난이도 (reading/speaking 우선 — 대본은 읽고 말하는 것)
  if answer_language and language_levels and isinstance(language_levels, dict):
    lang_block = language_levels.get(answer_language)
    if isinstance(lang_block, dict):
      reading = _level_label(lang_block.get('reading'))
      speaking = _level_label(lang_block.get('speaking'))
      listening = _level_label(lang_block.get('listening'))
      writing = _level_label(lang_block.get('writing'))
      if reading or speaking:
        parts_l = []
        if reading: parts_l.append(f'Reading {reading}')
        if speaking: parts_l.append(f'Speaking {speaking}')
        if listening: parts_l.append(f'Listening {listening}')
        if writing: parts_l.append(f'Writing {writing}')
        lines.append(
          f'### Reader Language Level ({answer_language})\n'
          f'{", ".join(parts_l)}.\n'
          f'- Write so the reader can both READ this aloud and UNDERSTAND it at their reading level.\n'
          f'- Pick the LOWER of reading/speaking levels as your ceiling.\n'
          f'- For Beginner/Elementary: only the 1500 most common words. Present tense. No idioms, no phrasal verbs, no loanwords.\n'
          f'- For Intermediate: common everyday vocabulary. Avoid jargon unless essential and then explain it in one word.\n'
          f'- For Advanced/Native: natural register, but still prefer short common words when possible.'
        )

  # 전문 지식 레벨
  exp = (expertise_level or '').lower()
  if exp:
    exp_map = {
      'layman': 'The listener is a non-expert — explain in plain terms, no domain jargon.',
      'practitioner': 'The listener knows the field at a working level — use standard terms but avoid obscure research jargon.',
      'expert': 'The listener is an expert — use precise domain terminology freely.',
    }
    if exp in exp_map:
      lines.append(f'### Expertise Level\n{exp_map[exp]}')

  # 말하기 좋은 단어 규칙 (모든 언어 공통 + 언어별 세부)
  speakable = [
    '### Speakable Vocabulary — you are writing a SPOKEN script, not written text',
    '- The user will READ THIS ALOUD in a meeting. Every word must be easy to pronounce out loud.',
    '- Prefer short, common words over long fancy ones.',
    '- Avoid tongue-twisters, complex consonant clusters, rare loanwords.',
    '- Use contractions and natural spoken register where appropriate.',
    '- Break long sentences into short ones. One idea per sentence.',
  ]
  if answer_language == 'en':
    speakable.append(
      '- English specifics: prefer Anglo-Saxon roots (get, show, help, need, make) '
      'over Latinate (obtain, demonstrate, facilitate, require, generate). '
      'Prefer 1-2 syllable words. Avoid academic connectors (moreover, furthermore, nonetheless).'
    )
  elif answer_language == 'ko':
    speakable.append(
      '- 한국어 규칙: 한자어보다 순우리말/일상어 우선 (예: "수행한다"보다 "한다", "제공한다"보다 "준다"). '
      '긴 명사구(~에 대한 ~의)를 풀어서 동사구로. 격식체보다 자연스러운 구어체. '
      '전문 용어는 필요할 때만 쓰고 한 번 풀어서 설명.'
    )
  elif answer_language == 'ja':
    speakable.append(
      '- 日本語ルール: 漢語より和語 (例: 「実施する」→「やる」). 長い名詞句を動詞句に. '
      '自然な会話体, 専門用語は必要最小限.'
    )
  lines.append('\n'.join(speakable))

  # 회의별 사용자 지정 스타일
  if meeting_style and meeting_style.strip():
    lines.append(f'### Meeting-specific Style (user-provided)\n{meeting_style.strip()}')

  return '\n\n'.join(lines) + '\n\n---\n\n'


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

단어 교정 (보수적 원칙, 명백한 오인식만 교체):

  **교정 가능한 조건 — 모두 충족해야 함:**
  1. 현재 단어가 **명백히 STT 오인식으로 보임** — 실제 단어로서 말이 안 되거나 (비단어), 문장 안에서 말이 전혀 안 통함
  2. **발음 유사성**이 있음 — 교체 후보 단어와 음가가 거의 동일
  3. 교체 후보가 **어휘 사전(Meeting Vocabulary) 안에 실제로 존재**함

  **우선순위:**
  - 1순위: Meeting Vocabulary 리스트와 음가 매우 유사 + 원본이 비단어/엉뚱 → 사전 단어로 교체.
    예: "레몬 워크" (한국어 문장에 섞여 말 안 됨) + vocab "remote work" → 교체.
  - 2순위: Recent Conversation 은 **참고용**으로만 사용. 원본 단어가 **그 자체로 말이 되면 절대 바꾸지 않는다**.
    예: 화자가 "지금은 요리 얘기인데..." 라고 맥락을 벗어나면 원본 그대로 보존. 맥락과 달라도 의도일 수 있음.
  - 3순위: 참여자 이름, 회사명, 제품명 등 고유명사의 명백한 음가 오인식.

  **교정 금지 (절대):**
  - 원본 단어가 **정상적인 단어이고 문장에서 의미가 통하면** 바꾸지 않는다. 주제와 달라도 유지.
  - 문장 구조/어순 변경, 단어 추가/삭제, 의역 금지. 단어 수준 1:1 교체만.
  - 의심되면 원본 보존. 과잉 교정이 누락 교정보다 훨씬 나쁨.
  - 어휘 사전이 없으면 고유명사 외에는 거의 교정하지 않는다.

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

Word correction (conservative principle, fix only clear STT mis-hears):

  **Correction is allowed ONLY when ALL of these hold:**
  1. The current word is **clearly an STT mis-recognition** — it's a non-word, or makes zero sense in the sentence
  2. There's strong **phonetic similarity** to the candidate replacement
  3. The replacement exists in the **Meeting Vocabulary list** (or is a listed proper noun)

  **Priorities:**
  - Priority 1: Phonetically close to a Meeting Vocabulary item AND the original is nonsense/non-word → replace.
    Example: "in Lemont Walk" (Lemont Walk makes no sense mid-sentence) + vocab contains "remote work" → replace with "in remote work".
  - Priority 2: Recent Conversation is **reference only**. If the original word **is a real word and makes sense on its own**, DO NOT change it, even if it's off-topic.
    Example: speaker suddenly says "let's talk about cooking for a second" — keep as-is; going off-topic is intentional.
  - Priority 3: Proper nouns — participant names, company names, product names with clear phonetic mis-hears.

  **NEVER:**
  - Replace a word that is a normal word and makes sense in the sentence, even if it's off-topic.
  - Change sentence structure, word order, add/remove words, paraphrase. Word-level 1:1 substitution only.
  - When in doubt, preserve the original. Over-correction is far worse than missed correction.
  - Without a vocabulary list, only correct obvious proper-noun mis-hears.

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


def _build_stt_correction_prefix(
  vocabulary: Optional[list[str]],
  recent_utterances: Optional[list[str]],
) -> str:
  """STT 교정용 컨텍스트 주입 블록 — 어휘 사전 + 직전 대화 맥락.
  중요: 이 블록은 "참고용 힌트". 원본 단어가 말이 되면 그대로 두어야 한다."""
  parts = []
  if vocabulary:
    items = vocabulary[:60]
    parts.append(
      '## Meeting Vocabulary (replacement candidates — USE ONLY IF original is a clear mis-hear)\n'
      'These terms appear in this meeting. If the input contains a nonsense/garbled word that '
      'sounds almost identical to one of these, replace it. Do NOT replace sensible words.\n- '
      + '\n- '.join(items)
    )
  if recent_utterances:
    recent = [u for u in recent_utterances[-3:] if u and u.strip()]
    if recent:
      parts.append(
        '## Recent Conversation (REFERENCE ONLY — not a filter)\n'
        'Background context of the meeting. Do NOT change words just because they are off-topic. '
        'Speakers may intentionally bring up unrelated things.\n'
        + '\n'.join(f'→ {u.strip()[:200]}' for u in recent)
      )
  if not parts:
    return ''
  return '\n\n'.join(parts) + '\n\n---\n\n'


async def translate_and_detect_question(
  text: str,
  meeting_context: Optional[dict] = None,
  language: Optional[str] = None,
  vocabulary: Optional[list[str]] = None,
  recent_utterances: Optional[list[str]] = None,
) -> dict:
  """
  Returns: {"formatted_original": str, "translation": str, "is_question": bool, "detected_language": str}
  language: 세션의 meeting_language (ko, en 등). 해당 언어의 질문 판정 규칙 적용.
  vocabulary: STT 교정용 어휘 사전 (고유명사/전문용어/외래어).
  recent_utterances: 직전 발화 3개까지 — 주제 문맥 기반 교정에 사용.
  """
  if not text or not text.strip():
    return {'formatted_original': text, 'translation': '', 'is_question': False, 'detected_language': 'unknown'}

  try:
    client = get_client()
    system_content = (
      _build_context_prefix(meeting_context)
      + _build_stt_correction_prefix(vocabulary, recent_utterances)
      + _build_translate_system(language)
    )
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
# Fast question detection — 병렬 경로용 (enrichment 기다리지 않음)
# ─────────────────────────────────────────────────────────
#
# 목표: STT 원문이 들어온 즉시 ~300ms 내에 질문 여부만 판정.
# 결과가 true 면 라이브 라우터가 prefetch_answer 를 즉시 시작.
# enrichment(정제+번역+정확 판정)는 병렬로 돌며 나중에 덮어쓴다.

FAST_QUESTION_SYSTEM_KO = """다음 한국어 발화가 "다른 사람에게 정보를 요청하는 질문" 인지 판정.

true 조건: 화자가 답을 모르고, 상대에게 구체 정보를 요청, 의문사+의문 어미 구조.
false: 확인("~지?"), 제안("~할까요?"), 요청("~해줘"), 감탄, 인사, 독백, 수사적 질문, 혼잣말.
의심되면 false.

JSON 1필드만 응답: {"q": true|false}"""

FAST_QUESTION_SYSTEM_EN = """Decide if the following English utterance is a real question asking someone else for information they don't know.

true: speaker doesn't know the answer, asks for specific info, proper Wh/yes-no structure.
false: requests, commands, tag questions, rhetorical, suggestions, embedded questions, greetings, self-directed.
When in doubt, false.

Respond with 1 JSON field only: {"q": true|false}"""

FAST_QUESTION_SYSTEM_DEFAULT = """Decide if the following utterance is a real information-seeking question.
true: speaker asks someone for specific unknown info.
false: requests, commands, rhetorical, greetings, self-talk, suggestions.
When in doubt, false.
Respond with 1 JSON field only: {"q": true|false}"""

_FAST_Q_MAP = {
  'ko': FAST_QUESTION_SYSTEM_KO,
  'en': FAST_QUESTION_SYSTEM_EN,
  'en-US': FAST_QUESTION_SYSTEM_EN,
  'en-GB': FAST_QUESTION_SYSTEM_EN,
}


QA_MATCH_SYSTEM = """You are a strict question-matching verifier. Your job is to PREVENT wrong answers by rejecting uncertain matches.

Given:
- A user question (what the speaker just asked)
- A numbered list of candidate pre-registered questions

Pick the candidate whose registered question is asking for the EXACT same information as the user question.

STRICT RULES (prefer 0 over a wrong guess):
- MATCH only if both questions ask for the same specific answer. Paraphrases and synonyms are OK, but the information need must be identical.
- NOT A MATCH cases (return 0):
  * The candidate is about a related but different aspect ("Why did you choose X?" vs "How does X work?" → 0)
  * The candidate has a broader or narrower scope
  * The candidate mentions X in passing but is really asking about Y
  * Word overlap exists but the questions are about different things
  * Candidate question is truncated or malformed (ends mid-word, missing subject, etc.)
  * You are not 100% sure
- If TWO candidates both match, pick the one whose wording is closer to the user question.
- If NONE match with certainty, return 0. Returning 0 is the safe default — wrong matches damage user trust far more than missing a match.

Respond ONLY with JSON: {"match": N, "reason": "<one sentence>"}
Where N = 1..K for a confident match, or 0 for no match.
"""


async def llm_match_question(
  query: str,
  candidates: list[str],
) -> int:
  """LLM 2차 매칭. query 가 candidates 중 어느 것과 의미가 같은지 판단.
  Returns: 1-based index of the matching candidate, or 0 if none."""
  if not candidates:
    return 0
  # 최대 5개까지만 (비용·지연 억제)
  candidates = candidates[:5]
  lines = '\n'.join(f'{i+1}. {c}' for i, c in enumerate(candidates))
  user_msg = f'User question: {query}\n\nCandidates:\n{lines}'
  try:
    client = get_client()
    resp = await client.chat.completions.create(
      model=LLM_MODEL,  # gpt-4.1-nano
      messages=[
        {'role': 'system', 'content': QA_MATCH_SYSTEM},
        {'role': 'user', 'content': user_msg},
      ],
      response_format={'type': 'json_object'},
      max_completion_tokens=120,
      temperature=0,
    )
    data = json.loads(resp.choices[0].message.content or '{}')
    n = int(data.get('match', 0))
    if 1 <= n <= len(candidates):
      logger.info(f'llm_match_question: matched={n} reason={data.get("reason", "")[:80]}')
      return n
    logger.info(f'llm_match_question: no-match reason={data.get("reason", "")[:80]}')
    return 0
  except Exception as e:
    logger.warning(f'llm_match_question failed: {e}')
    return 0


async def detect_question_fast(text: str, language: Optional[str] = None) -> bool:
  """초경량 질문 판정. gpt-4.1-nano + 20 토큰.
  Returns: True if likely question. 실패 시 False (보수적)."""
  if not text or not text.strip():
    return False
  system = _FAST_Q_MAP.get(language or '', FAST_QUESTION_SYSTEM_DEFAULT)
  try:
    client = get_client()
    resp = await client.chat.completions.create(
      model=LLM_MODEL,  # gpt-4.1-nano
      messages=[
        {'role': 'system', 'content': system},
        {'role': 'user', 'content': text[:500]},
      ],
      response_format={'type': 'json_object'},
      max_completion_tokens=20,
    )
    data = json.loads(resp.choices[0].message.content or '{}')
    return bool(data.get('q', False))
  except Exception as e:
    logger.warning(f'detect_question_fast failed: {e}')
    return False


# ─────────────────────────────────────────────────────────
# Vocabulary extraction — 회의 자료/브리프에서 STT 보정용 어휘 사전 추출
# ─────────────────────────────────────────────────────────
#
# 사용자가 "remote work" 라고 말했는데 STT 가 "Lemont Walk" 로 잡는 문제 해결:
#   1) Deepgram keyword boosting → 같은 음가의 정답 단어 후보 제공
#   2) LLM 교정 시 이 사전을 주입 → 문맥상 교정 가능
# 추출 대상: 회의 주제의 핵심 용어, 도메인 용어, 고유명사, 외래어

VOCAB_EXTRACT_SYSTEM = """You extract a vocabulary list for speech-to-text correction in a live meeting.

# ABSOLUTE RULE — EXTRACTION ONLY, NO INFERENCE

You are a **TERM EXTRACTOR**, not a brainstormer.

- **ONLY output terms that appear VERBATIM in the source materials below.**
- **NEVER invent, generalize, summarize, or infer terms.** If the brief says "Research on remote work" do NOT add "productivity", "time management", "collaboration tools" — those are GUESSES.
- If a term is not literally present in the provided text, it must NOT appear in your output.
- Prefer longer multi-word phrases verbatim over split words.
- Preserve original capitalization, spelling, punctuation.
- Copy proper nouns, product names, technical terms, acronyms exactly as written.
- If the Meeting Language is different from the source language, still COPY source terms AS-IS (speakers code-switch).

# What to extract

From the source materials, copy:
- Proper nouns (people, places, companies, products, publications)
- Technical terms and domain jargon
- Acronyms and their expansions (if both appear)
- Multi-word compounds likely to be spoken (e.g. "machine learning", "self-efficacy")
- Numbers + units (e.g. "300%", "47 participants")
- Author/researcher names
- Method/theory names (e.g. "grounded theory", "regression analysis")

# What NOT to extract
- Common function words ("the", "and", "of")
- Generic single words not in the source ("productivity", "performance" — unless literally in text)
- Your own paraphrases or synonyms
- Terms that are NOT in the source — even if they seem related

# Quantity
- **If source materials are rich**: 40-80 verbatim terms
- **If source materials are minimal (only a short brief)**: 5-20 terms maximum. Do NOT pad by inventing.
- **If source provides nothing extractable**: return an empty list `{"vocabulary": []}` — DO NOT GUESS.

Respond ONLY with strict JSON:
{"vocabulary": ["term 1", "term 2", "..."]}
"""


async def generate_vocabulary_list(
  brief: Optional[str] = None,
  pasted_context: Optional[str] = None,
  participants: Optional[list] = None,
  user_profile: Optional[dict] = None,
  meeting_languages: Optional[list] = None,
  document_excerpts: Optional[list] = None,
) -> list[str]:
  """회의 컨텍스트에서 STT 보정용 어휘 사전 추출.

  meeting_languages: ISO 639-1 코드 리스트 (e.g. ['en'], ['ko'], ['en','ko']).
    LLM 에게 이 언어로만 키워드 반환하라고 지시.
  document_excerpts: 인덱싱된 문서의 청크 텍스트 리스트 (최대 ~6000자).
    원자료에서 직접 추출 → 가장 정확한 키워드 소스.
  """
  parts = []

  # 회의 언어 명시 — LLM 이 해당 언어로만 키워드 반환
  if meeting_languages:
    langs = [l for l in meeting_languages if isinstance(l, str)]
    if langs:
      lang_names = {
        'ko': 'Korean (한국어)',
        'en': 'English',
        'ja': 'Japanese (日本語)',
        'zh': 'Chinese (中文)',
        'es': 'Spanish',
        'fr': 'French',
        'de': 'German',
      }
      names = ', '.join(lang_names.get(l, l) for l in langs)
      parts.append(f'## Meeting Language(s) — KEYWORDS MUST BE IN THESE LANGUAGE(S)\n{names}')

  if brief:
    parts.append(f'## Meeting Brief\n{brief.strip()[:3000]}')
  if participants and isinstance(participants, list):
    names = []
    for p in participants:
      if isinstance(p, dict):
        n = (p.get('name') or '').strip()
        r = (p.get('role') or '').strip()
        if n:
          names.append(f'- {n}' + (f' ({r})' if r else ''))
    if names:
      parts.append('## Participants\n' + '\n'.join(names))
  if user_profile and isinstance(user_profile, dict):
    lines = []
    for k in ('job_title', 'organization', 'expertise', 'bio'):
      v = user_profile.get(k)
      if v:
        lines.append(f'- {k}: {v}')
    if lines:
      parts.append('## User Profile\n' + '\n'.join(lines))
  if pasted_context:
    parts.append(f'## Reference Text (pasted)\n{pasted_context.strip()[:6000]}')

  # 문서 발췌 — 가장 강력한 소스. 원어 그대로
  if document_excerpts:
    combined = '\n\n---\n\n'.join(e for e in document_excerpts if e)[:8000]
    if combined:
      parts.append(f'## Source Document Excerpts (most important — extract keywords from here as-is)\n{combined}')

  if not parts:
    return []

  user_msg = '\n\n'.join(parts)
  try:
    client = get_client()
    resp = await client.chat.completions.create(
      model=LLM_MODEL_ANSWER,
      messages=[
        {'role': 'system', 'content': VOCAB_EXTRACT_SYSTEM},
        {'role': 'user', 'content': user_msg},
      ],
      response_format={'type': 'json_object'},
      max_completion_tokens=2000,
    )
    data = json.loads(resp.choices[0].message.content or '{}')
    raw = data.get('vocabulary', [])
    if not isinstance(raw, list):
      return []
    out = []
    seen = set()
    for w in raw:
      if not isinstance(w, str):
        continue
      w = ' '.join(w.split()).strip()
      if not w or len(w) < 2 or len(w) > 80:
        continue
      k = w.lower()
      if k in seen:
        continue
      seen.add(k)
      out.append(w)
      if len(out) >= 80:
        break
    return out
  except Exception as e:
    logger.warning(f'generate_vocabulary_list failed: {e}')
    return []


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

ANSWER_SYSTEM_RAG = """You are preparing an answer that the user (described in "Your Profile" above) will SPEAK ALOUD in their meeting.

**CRITICAL: You are NOT an AI assistant. You ARE the person described in the profile.**
Speak in first person as that person. Use "I", "my", "we" naturally.
Never say "As an AI", "I don't have personal preferences", "I'm here to help". You are a real human answering.

**CRITICAL: Obey the Answer Style Rules above (length, language level, speakable vocabulary, expertise level, meeting-specific style). They override any tendency you have to write longer, fancier, or more academic answers.**

Rules:
1. Answer in {answer_lang_name}, in first person, as the profile's person.
2. Use the document excerpts below to ground your answer when relevant.
3. Match the person's tone authentically.
4. For conversational questions, answer as the person would based on their bio.
5. If the question asks about SPECIFIC DATA of THIS study (sample size, participant count, data collection date, results numbers, effect sizes) AND the excerpts do NOT clearly contain that data from the study's own methodology/results section, answer NATURALLY as the researcher still working it out. Use casual first-person phrases that deflect gracefully — e.g. "I haven't finalized that yet", "I'm still working out the exact number", "That's something I'm still determining", "아직 그 부분은 확정하지 못했어요", "그 수치는 아직 정리 중이에요". Adapt to the answer language. NEVER sound robotic with phrases like "not specified in the available materials" or "자료에서 답을 찾지 못했습니다" — you are a human researcher, not a database.
6. Numbers appearing in excerpts may be from CITED prior studies (Ragu-Nathan et al. 2008, Stajkovic & Luthans 1998, etc.), not from THIS study. Only attribute a number to THIS study if the excerpt clearly states it (e.g., "our sample", "we collected", "this study included", "participants in this research"). DO NOT fabricate by picking a cited reference number.
7. Respect the Length rule strictly. Short means SHORT. Do not pad.

Confidence:
- "high" — grounded in context or profile
- "medium" — reasonable inference
- "low" — speculative

Respond ONLY with strict JSON:
{{"answer": "...", "confidence": "high"|"medium"|"low"}}
"""

ANSWER_SYSTEM_GENERAL = """You are preparing an answer that the user (described in "Your Profile" above) will SPEAK ALOUD in their meeting.

**CRITICAL: You are NOT an AI assistant. You ARE the person described in the profile.**
Speak in first person as that person. Use "I", "my", "we" naturally.
Never say "As an AI", "I don't have personal preferences", "I'm here to help", or anything that breaks the first-person persona. You are a real human answering.

**CRITICAL: Obey the Answer Style Rules above (length, language level, speakable vocabulary, expertise level, meeting-specific style). They override any tendency you have to write longer, fancier, or more academic answers.**

Rules:
1. Answer in {answer_lang_name}, in first person, as the profile's person.
2. Base your answer on the profile — the person's role, expertise, organization, background.
3. For factual questions, use general knowledge as that person would know it.
4. Be specific and personal, not generic.
5. Respect the Length rule strictly. Short means SHORT. Do not pad.

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


_LENGTH_MAX_TOKENS = {
  'short': 150,
  'medium': 300,
  'long': 500,
}


async def generate_answer(
  question: str,
  context_chunks: list,
  meeting_context: Optional[dict] = None,
  answer_language: Optional[str] = None,
  language_levels: Optional[dict] = None,
  expertise_level: Optional[str] = None,
  meeting_style: Optional[str] = None,
  meeting_length: Optional[str] = None,
  session_history: Optional[list] = None,
) -> dict:
  """
  답변 생성 (번역 없음 — 속도 우선).
  context_chunks 유무에 따라 RAG vs general 프롬프트 분기.
  style_prefix 로 언어 레벨/길이/말하기 규칙/회의별 스타일 주입.
  session_history: 같은 세션의 이전 질문-답변 리스트 (중복 방지용). [{q, a}]
  Returns: {"answer": str, "confidence": str}
  """
  ans_lang = answer_language or 'the same language as the question'
  ans_lang_name = _lang_name(ans_lang) if ans_lang != 'the same language as the question' else ans_lang

  style_prefix = _build_answer_style_prefix(
    answer_language=answer_language,
    language_levels=language_levels,
    expertise_level=expertise_level,
    meeting_style=meeting_style,
    meeting_length=meeting_length,
  )

  # 세션 이력: 최근 Q&A 3-5개 주입 (중복 답변 방지)
  history_block = ''
  if session_history:
    lines = []
    for i, item in enumerate(session_history[-5:], 1):
      q = (item.get('q') or '').strip()[:200]
      a = (item.get('a') or '').strip()[:300]
      if q and a:
        lines.append(f'{i}. Q: {q}\n   A: {a}')
    if lines:
      history_block = (
        '## Prior Q&A in THIS meeting (do not repeat verbatim; '
        'build on or cross-reference when relevant)\n'
        + '\n'.join(lines) + '\n\n---\n\n'
      )

  if context_chunks:
    context = '\n\n---\n\n'.join(context_chunks)
    user_msg = f'Context:\n{context}\n\nQuestion: {question}'
    system_prompt = ANSWER_SYSTEM_RAG.replace('{answer_lang_name}', ans_lang_name)
  else:
    user_msg = f'Question: {question}'
    system_prompt = ANSWER_SYSTEM_GENERAL.replace('{answer_lang_name}', ans_lang_name)

  client = get_client()
  # 길이 규칙을 프롬프트 맨 끝에 다시 한번 강조 — LLM 은 마지막 텍스트를 더 잘 따른다
  final_length_reminder = (
    f'\n\n---\nFINAL REMINDER — length rule for THIS answer: '
    f'{_LENGTH_INSTRUCTIONS.get(meeting_length or "medium", _LENGTH_INSTRUCTIONS["medium"])}\n'
    f'Write only the answer. Count your words before returning JSON.'
  )
  system_content = (
    _build_context_prefix(meeting_context)
    + style_prefix
    + history_block
    + system_prompt
    + final_length_reminder
  )
  max_tokens = _LENGTH_MAX_TOKENS.get(meeting_length or 'medium', 400)
  try:
    response = await client.chat.completions.create(
      model=LLM_MODEL_ANSWER,
      messages=[
        {'role': 'system', 'content': system_content},
        {'role': 'user', 'content': user_msg},
      ],
      response_format={'type': 'json_object'},
      max_completion_tokens=max_tokens,
    )
    data = json.loads(response.choices[0].message.content)
    answer = data.get('answer', '')
    # 서버 하드 캡 — LLM 이 지시를 안 지키는 경우 안전망
    if answer and meeting_length:
      answer = _enforce_length_cap(answer, meeting_length)
    return {
      'answer': answer,
      'confidence': data.get('confidence', 'low'),
    }
  except Exception as e:
    logger.error(f'generate_answer failed: {e}')
    return {'answer': '', 'confidence': 'low', 'error': str(e)}


_LENGTH_WORD_CAP = {'short': 27, 'medium': 55, 'long': 85}
_LENGTH_SENT_CAP = {'short': 2, 'medium': 3, 'long': 4}


def _enforce_length_cap(text: str, length: str) -> str:
  """LLM 이 길이 규칙을 어겼을 때 후처리로 자름.
  단어 캡 + 문장 캡 중 먼저 도달하는 것 기준."""
  import re
  word_cap = _LENGTH_WORD_CAP.get(length, 85)
  sent_cap = _LENGTH_SENT_CAP.get(length, 4)
  # 문장 분리 (한/영 공통)
  sentences = re.split(r'(?<=[.!?。!?])\s+', text.strip())
  sentences = [s for s in sentences if s]
  if len(sentences) > sent_cap:
    sentences = sentences[:sent_cap]
  capped = ' '.join(sentences).strip()
  # 단어 캡 (공백 기준, 한국어도 공백 단위라 단어수 대략적)
  words = capped.split()
  if len(words) > word_cap:
    words = words[:word_cap]
    capped = ' '.join(words)
    # 문장 끝 기호 추가 (없으면)
    if not re.search(r'[.!?。!?]$', capped):
      capped += '.'
  return capped


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


async def augment_answer_with_rag(
  question: str,
  registered_answer: str,
  doc_chunks: list[str],
  meeting_context: Optional[dict] = None,
  answer_language: Optional[str] = None,
  meeting_length: Optional[str] = None,
) -> dict:
  """Priority/custom tier 의 등록된 답변을 문서 RAG 로 보강.

  정책:
  - 등록된 답변이 사용자 질문을 충분히 커버하면 원문 그대로 유지.
  - 사용자가 구체 정보 (숫자/날짜/이름/횟수 등) 를 묻는데 등록된 답변이 일반적이면,
    문서 청크에서 해당 구체 정보만 찾아 등록된 답변에 자연스럽게 추가.
  - 등록된 답변과 모순되는 내용은 절대 추가하지 않음.
  - 문서에도 정보가 없으면 등록된 답변을 그대로 반환.

  Returns: {"answer": str, "augmented": bool, "reason": str}
  """
  if not doc_chunks:
    return {'answer': registered_answer, 'augmented': False, 'reason': 'no chunks'}

  ans_lang = answer_language or 'the same language as the question'
  ans_lang_name = _lang_name(ans_lang) if ans_lang != 'the same language as the question' else ans_lang

  # 길이 예산 — meeting_length 에 따라 cap. 이 cap 안에서 augment 해야 함.
  # short: 2문장, medium: 3문장, long: 4문장
  length_budget = {
    'short': '2 sentences maximum, under 27 words total. Be very concise.',
    'medium': '3 sentences maximum, under 55 words total.',
    'long': '4 sentences maximum, under 85 words total.',
  }.get(meeting_length or 'medium', '3 sentences maximum, under 55 words total.')

  # 토큰 예산: 청크 10000자 cap
  chunks_text = '\n\n---\n\n'.join(doc_chunks)
  if len(chunks_text) > 10000:
    chunks_text = chunks_text[:10000] + '\n\n[... truncated]'

  system = (
    f'You are reviewing whether a pre-registered answer fully addresses a user question. '
    f'Respond in {ans_lang_name}.\n\n'
    'You have THREE inputs:\n'
    '1. User question (what the speaker just asked)\n'
    '2. Pre-registered answer (the canonical answer already chosen from the user\'s Q&A file)\n'
    '3. Supplementary document chunks (the user\'s uploaded research/reference materials)\n\n'
    'STEP 1 — Determine what SPECIFIC DETAIL the user is asking for:\n'
    '- "how many / how much / what is the number / count / size": requires a NUMBER (digit)\n'
    '- "when / what date / what year": requires a DATE or YEAR\n'
    '- "who / by whom": requires a NAME (person or organization)\n'
    '- "where / what location": requires a LOCATION\n'
    '- "what percentage / ratio": requires a PERCENTAGE\n'
    '- "what is X / define X / explain X": definitional — qualitative answer is OK\n\n'
    'STEP 2 — Check if the required specific type is PRESENT in the pre-registered answer.\n'
    'Example: if user asked "how many" and the answer says "sufficient" with no digit, the NUMBER is MISSING.\n'
    'Qualitative adjectives ("sufficient", "adequate", "enough", "many", "few") do NOT count as a number.\n\n'
    'STEP 3 — Apply one of these rules and return JSON:\n'
    '(A) Pre-registered answer FULLY covers the question (no specific detail required, OR specific detail is present) → '
    '{"answer": "<verbatim>", "augmented": false, "reason": "complete"}\n'
    '(B) Specific detail MISSING from pre-registered answer, BUT PRESENT in document chunks → '
    'augment by adding that concrete detail in a short natural sentence (keep original voice). '
    '{"answer": "<enriched>", "augmented": true, "reason": "added <specific>"}\n'
    '(C) Specific detail MISSING from pre-registered answer AND NOT found in document chunks → '
    'rewrite the answer as a natural first-person acknowledgment that THIS detail is still being worked out, '
    'while preserving the core message of the pre-registered answer. '
    'Use casual phrases like "I haven\'t finalized that yet", "still working on the exact number", '
    '"그 수치는 아직 정리 중이에요", "아직 확정하지는 않았어요" — match the answer language. '
    'Sound like a human researcher mid-project, NOT like a database saying "not specified". '
    '{"answer": "<natural rewrite>", "augmented": true, "reason": "data not yet finalized"}\n\n'
    'HARD CONSTRAINTS:\n'
    '- NEVER contradict the pre-registered answer.\n'
    '- NEVER invent information not present in the chunks.\n'
    '- Keep language, tone, and first-person voice of the original.\n'
    f'- LENGTH BUDGET: {length_budget} The ENTIRE final answer (including any augmentation or note) must fit within this budget. '
    'If needed, REPLACE a less critical part of the original with the specific detail or missing-data note so the total stays within budget. '
    'Preserve the factual core of the original.\n\n'
    'OUTPUT: strict JSON only. No markdown.'
  )

  user_msg = (
    f'User question:\n{question}\n\n'
    f'Pre-registered answer:\n{registered_answer}\n\n'
    f'Document chunks (supplementary):\n{chunks_text}'
  )

  client = get_client()
  try:
    resp = await client.chat.completions.create(
      model=LLM_MODEL_ANSWER,
      messages=[
        {'role': 'system', 'content': _build_context_prefix(meeting_context) + system},
        {'role': 'user', 'content': user_msg},
      ],
      response_format={'type': 'json_object'},
      max_completion_tokens=500,
      temperature=0,
    )
    raw = resp.choices[0].message.content or '{}'
    data = json.loads(raw)
    answer = (data.get('answer') or registered_answer).strip()
    augmented = bool(data.get('augmented', False))
    reason = (data.get('reason') or '').strip()[:120]
    # 디버깅: LLM 이 augmented=true 라고 했는데 answer 가 원문과 동일하면 flag 로그
    if augmented and answer.strip() == registered_answer.strip():
      logger.warning(f'augment: LLM claimed augmented but answer unchanged. reason={reason!r} raw={raw[:200]!r}')
    return {'answer': answer, 'augmented': augmented, 'reason': reason}
  except Exception as e:
    logger.warning(f'augment_answer_with_rag failed: {e}')
    return {'answer': registered_answer, 'augmented': False, 'reason': f'error: {type(e).__name__}'}


async def extract_qa_pairs_from_text(
  text: str,
  source_hint: Optional[str] = None,
) -> list[dict]:
  """
  자유 형식 텍스트(PDF/DOCX/TXT/MD)에서 Q&A 쌍을 복사 추출.

  *추출 전용* — 원문에 있는 Q&A 를 verbatim 으로 뽑기만 한다. 없는 것을 만들지 않는다.
  Returns: [{"question": str, "answer": str, "short_answer": str|None, "keywords": str|None, "category": str|None}]
  """
  if not text or not text.strip():
    return []

  # 토큰 예산: ~15000자 (약 5000 토큰). 초과 시 잘라냄.
  src = text.strip()
  if len(src) > 15000:
    src = src[:15000] + '\n\n[... truncated]'

  system = (
    "You are a Q&A EXTRACTOR. Copy Q&A pairs verbatim from the source text.\n"
    "\n"
    "HARD RULES:\n"
    "- Extract ONLY question+answer pairs that explicitly exist in the source.\n"
    "- Copy text verbatim. Do not paraphrase, rewrite, or summarize.\n"
    "- Do not invent Q&A from general knowledge. If source has no Q&A, return empty list.\n"
    "- Detect patterns: 'Q: ... A: ...', 'Question: ... Answer: ...', '질문: ... 답변: ...', "
    "numbered Q1./A1., FAQ style, dialog blocks, or tables with Q/A columns.\n"
    "- Preserve the original language of each Q&A (do not translate).\n"
    "- If an answer has multiple paragraphs, keep them all together as one answer.\n"
    "- If the same question appears multiple times, include it only once (keep the most detailed answer).\n"
    "\n"
    "OPTIONAL FIELDS (leave null if not clearly in source):\n"
    "- short_answer: one-sentence compressed version (only if source provides a clearly separate short form).\n"
    "- keywords: comma-separated key terms from the Q&A text.\n"
    "- category: section/topic heading the Q&A appeared under.\n"
    "\n"
    "OUTPUT: JSON {\"qa_pairs\": [{\"question\": str, \"answer\": str, "
    "\"short_answer\": str|null, \"keywords\": str|null, \"category\": str|null}]}\n"
    "If no Q&A found, return {\"qa_pairs\": []}."
  )

  user_msg = f'Source text{f" (from {source_hint})" if source_hint else ""}:\n\n{src}'

  client = get_client()
  try:
    response = await client.chat.completions.create(
      model=LLM_MODEL_ANSWER,
      messages=[
        {'role': 'system', 'content': system},
        {'role': 'user', 'content': user_msg},
      ],
      response_format={'type': 'json_object'},
      max_completion_tokens=4000,
      temperature=0,
    )
    data = json.loads(response.choices[0].message.content)
    pairs = data.get('qa_pairs', [])
    out: list[dict] = []
    for p in pairs:
      if not isinstance(p, dict):
        continue
      q = (p.get('question') or '').strip()
      a = (p.get('answer') or '').strip()
      if not q or not a:
        continue
      out.append({
        'question': q[:2000],
        'answer': a[:5000],
        'short_answer': ((p.get('short_answer') or '').strip() or None) if isinstance(p.get('short_answer'), str) else None,
        'keywords': ((p.get('keywords') or '').strip() or None) if isinstance(p.get('keywords'), str) else None,
        'category': ((p.get('category') or '').strip() or None) if isinstance(p.get('category'), str) else None,
      })
    logger.info(f'extract_qa_pairs_from_text: {len(out)} pairs extracted (source={source_hint})')
    return out
  except Exception as e:
    logger.error(f'extract_qa_pairs_from_text failed: {e}')
    return []


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
