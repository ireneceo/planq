"""
LLM service — translation, question detection, summary, answer generation.

LLM_PROVIDER 환경변수로 제공자 교체 가능 (현재 openai만 지원).
모델 교체 시 LLM_MODEL 변경.
"""
import os
import json
import logging
from typing import Optional
from openai import AsyncOpenAI

logger = logging.getLogger('q-note.llm')

LLM_PROVIDER = os.getenv('LLM_PROVIDER', 'openai')
LLM_MODEL = os.getenv('LLM_MODEL', 'gpt-4o-mini')
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
# Translation + Question Detection (one call)
# ─────────────────────────────────────────────────────────

TRANSLATE_SYSTEM = """You are a real-time meeting assistant.
Given an utterance from a meeting, do TWO things in one response:

1. Translate it:
   - If the input is Korean, translate to English.
   - If the input is English, translate to Korean.
   - If the input is mixed, translate the whole thing into the dominant language's counterpart.
   - Keep proper nouns as-is.
   - Preserve tone (formal/casual).

2. Detect if it's a question:
   - true if it's interrogative, request form ("can you...", "could you..."),
     or seeking confirmation ("is that right?", "맞나요?", "~인가요?").
   - false otherwise.

Respond ONLY with strict JSON:
{"translation": "...", "is_question": true|false, "detected_language": "ko"|"en"|"mixed"}
"""


async def translate_and_detect_question(text: str) -> dict:
  """
  Returns: {"translation": str, "is_question": bool, "detected_language": str}
  """
  if not text or not text.strip():
    return {'translation': '', 'is_question': False, 'detected_language': 'unknown'}

  try:
    client = get_client()
    response = await client.chat.completions.create(
      model=LLM_MODEL,
      messages=[
        {'role': 'system', 'content': TRANSLATE_SYSTEM},
        {'role': 'user', 'content': text},
      ],
      response_format={'type': 'json_object'},
      max_completion_tokens=500,
    )
    content = response.choices[0].message.content
    data = json.loads(content)
    return {
      'translation': data.get('translation', ''),
      'is_question': bool(data.get('is_question', False)),
      'detected_language': data.get('detected_language', 'unknown'),
    }
  except Exception as e:
    logger.error(f'translate_and_detect_question failed: {e}')
    return {
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


async def generate_summary(transcript: str) -> dict:
  """Returns: {"key_points": list[str], "full_summary": str}"""
  if not transcript.strip():
    return {'key_points': [], 'full_summary': ''}

  client = get_client()
  response = await client.chat.completions.create(
    model=LLM_MODEL,
    messages=[
      {'role': 'system', 'content': SUMMARY_SYSTEM},
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

ANSWER_SYSTEM = """You are a Q&A assistant grounded in provided document excerpts.
Answer the user's question using ONLY the provided context. If the answer isn't in the context, say so honestly.
Match the language of the question.

Respond ONLY with strict JSON:
{"answer": "...", "confidence": "high"|"medium"|"low"}
"""


async def generate_answer(question: str, context_chunks: list) -> dict:
  """Returns: {"answer": str, "confidence": str}"""
  context = '\n\n---\n\n'.join(context_chunks) if context_chunks else '(no documents)'
  user_msg = f'Context:\n{context}\n\nQuestion: {question}'

  client = get_client()
  response = await client.chat.completions.create(
    model=LLM_MODEL,
    messages=[
      {'role': 'system', 'content': ANSWER_SYSTEM},
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
