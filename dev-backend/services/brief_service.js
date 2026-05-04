// 자료정리 (Brief) — 텍스트·파일 여러 개 → AI 통합 정리 + 시점 추출 + 후속 문서 추천.
//
// 흐름:
//   1) 입력: text_blocks (사용자 paste 한 텍스트들) + attached_file_ids (이미 업로드된 File row id 들)
//   2) 파일 본문 추출 — File.file_path 에서 텍스트 읽기 (txt/pdf/docx 일부 — 1차는 text/* 와 단순 PDF 만)
//   3) LLM 1회 호출 (gpt-4o-mini, JSON 응답): timeline + summary + recommended_next_kind
//   4) 결과를 Post 로 저장 (category='brief', brief_meta JSON 에 source list 저장, content_json 에 정리된 본문)
//   5) cue_orchestrator.checkUsageLimit + recordUsage('brief') — Cue 통합 사용량
//
// 응답: { post_id, brief_meta, recommended_next_kind, usage }

const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { File, Post, sequelize } = require('../models');
const cueOrch = require('./cue_orchestrator');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = 'gpt-4o-mini';

// 파일 본문 텍스트 추출 — 1차 출시는 text/* 와 단순 PDF 만 지원.
// 실패 시 빈 문자열 반환 (graceful — LLM 이 텍스트 부분만 처리).
async function extractFileText(fileRow) {
  if (!fileRow || !fileRow.file_path) return '';
  if (fileRow.storage_provider !== 'planq') return '';  // gdrive 등 외부는 1차 미지원
  const abs = path.isAbsolute(fileRow.file_path)
    ? fileRow.file_path
    : path.resolve(__dirname, '..', fileRow.file_path);
  if (!fs.existsSync(abs)) return '';
  const mime = String(fileRow.mime_type || '').toLowerCase();
  try {
    if (mime.startsWith('text/') || mime === 'application/json') {
      return fs.readFileSync(abs, 'utf-8').slice(0, 50_000);
    }
    if (mime === 'application/pdf') {
      // PDF 텍스트 추출 — pdf-parse 가 있으면 사용 (의존성 추가 안 함, optional require)
      try {
        const pdfParse = require('pdf-parse');
        const dataBuffer = fs.readFileSync(abs);
        const data = await pdfParse(dataBuffer);
        return String(data.text || '').slice(0, 50_000);
      } catch { return ''; }
    }
    return '';  // docx/xlsx 등은 1.x
  } catch (e) {
    console.warn('[brief_service] extractFileText failed:', fileRow.id, e.message);
    return '';
  }
}

// LLM 시스템 프롬프트 — 시점 추출 + 통합 정리 + 후속 문서 추천 한 번에 (호출 1회 절약)
const SYSTEM_PROMPT = `당신은 자료 정리 전문가입니다. 사용자가 제공한 여러 자료(텍스트·파일 본문)를 통합 정리합니다.

## 출력 형식 (JSON)
{
  "summary": "전체 요약 — 2~5 문장. 핵심만",
  "view_kind": "time" | "file",
  "timeline": [
    { "when": "YYYY-MM-DD HH:mm 또는 자유 텍스트(2026-04-15, 1분기, 회의 직후 등)", "title": "제목", "content": "내용 한 단락", "source": "source 이름" }
  ],
  "by_file": [
    { "source": "source 이름", "summary": "그 자료의 요약", "key_points": ["핵심 1", "핵심 2", "..."] }
  ],
  "recommended_next_kind": "meeting_note" | "proposal" | "quote" | "contract" | "nda" | "sop" | "custom",
  "recommended_next_reason": "왜 이 종류가 적절한지 한 문장"
}

## 규칙
1. timeline 은 자료에 명확한 시점(날짜·시각·순서)이 있을 때만 채움. 없으면 빈 배열 + view_kind="file"
2. by_file 은 항상 채움 (source 별 요약). 단일 source 면 1개 항목
3. timeline 항목 5~30개 권장. 너무 짧지도 너무 길지도 않게
4. 같은 내용이 여러 source 에 중복되면 timeline 에는 한 번만 (source 합쳐서 표기)
5. recommended_next_kind 는 자료 성격으로 판단:
   - 회의·미팅 자료 → meeting_note
   - 클라이언트 요청·견적 요청 → quote 또는 proposal
   - 계약 협상 → contract 또는 nda
   - 절차·운영 가이드 → sop
   - 기타 → custom
6. 모든 출력은 한국어 (입력이 다국어여도 정리는 한국어). 단 고유명사는 원어 유지`;

async function buildAndCreatePost(opts) {
  const {
    business_id, project_id = null, conversation_id = null,
    title, text_blocks = [], attached_file_ids = [], attached_post_ids = [], created_by,
  } = opts;
  if (!business_id || !created_by) throw new Error('business_id and created_by required');
  if (!title || !String(title).trim()) throw new Error('title required');
  if (text_blocks.length === 0 && attached_file_ids.length === 0 && attached_post_ids.length === 0) {
    throw new Error('at least one text block, file, or post required');
  }

  // 1) 한도 검사
  const usage = await cueOrch.checkUsageLimit(business_id);
  if (usage.over) {
    const e = new Error('cue_limit_exceeded');
    e.usage = usage;
    throw e;
  }

  // 2) 파일 본문 추출
  const sources = [];  // [{ source: 'paste-1' | 'file:foo.pdf', text: '...' }]
  text_blocks.forEach((tb, idx) => {
    const txt = String(tb || '').trim();
    if (txt) sources.push({ source: `paste-${idx + 1}`, text: txt.slice(0, 50_000) });
  });
  if (attached_file_ids.length > 0) {
    const files = await File.findAll({
      where: { id: { [Op.in]: attached_file_ids }, business_id, deleted_at: null },
    });
    for (const f of files) {
      const text = await extractFileText(f);
      sources.push({
        source: `file:${f.original_name || f.file_name || `file-${f.id}`}`,
        text: text || `(파일 본문 추출 실패: ${f.mime_type || 'unknown mime'})`,
        file_id: f.id,
      });
    }
  }
  if (attached_post_ids.length > 0) {
    const posts = await Post.findAll({
      where: { id: { [Op.in]: attached_post_ids }, business_id },
      attributes: ['id', 'title', 'content_text', 'content_json', 'kind'],
    });
    for (const p of posts) {
      let text = String(p.content_text || '').trim();
      if (!text && p.content_json) {
        // content_json 이 TipTap 객체 — text 노드만 평면화
        try {
          const json = typeof p.content_json === 'string' ? JSON.parse(p.content_json) : p.content_json;
          const collect = (n) => {
            if (!n) return '';
            if (typeof n === 'string') return n;
            if (n.text) return n.text;
            if (Array.isArray(n.content)) return n.content.map(collect).join(' ');
            return '';
          };
          text = collect(json).replace(/\s+/g, ' ').trim();
        } catch { /* skip */ }
      }
      if (text) {
        sources.push({
          source: `post:${p.title || `post-${p.id}`}`,
          text: text.slice(0, 50_000),
          post_id: p.id,
        });
      }
    }
  }
  if (sources.length === 0) throw new Error('no content extracted');

  // 3) LLM 호출
  const userMsg = sources.map((s, i) =>
    `[${s.source}]\n${s.text || '(빈 본문)'}\n`
  ).join('\n---\n');
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg.slice(0, 100_000) },
      ],
      temperature: 0.2,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`LLM ${r.status}: ${errText.slice(0, 200)}`);
  }
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(`brief LLM JSON parse failed: ${e.message}`);
  }

  const summary = String(parsed.summary || '').slice(0, 2000);
  const viewKind = parsed.view_kind === 'time' ? 'time' : 'file';
  const timeline = Array.isArray(parsed.timeline) ? parsed.timeline.slice(0, 50) : [];
  const byFile = Array.isArray(parsed.by_file) ? parsed.by_file.slice(0, 30) : [];
  const recommendedKind = ['meeting_note', 'proposal', 'quote', 'contract', 'nda', 'sop', 'custom']
    .includes(parsed.recommended_next_kind) ? parsed.recommended_next_kind : 'custom';
  const recommendedReason = String(parsed.recommended_next_reason || '').slice(0, 300);

  // 4) content_json (TipTap) 으로 직렬화 — 시점 또는 파일 기준
  const contentDoc = buildTipTapDoc({ summary, viewKind, timeline, byFile });
  const contentText = buildPlainText({ summary, viewKind, timeline, byFile });

  // 5) Post 생성
  const post = await Post.create({
    business_id,
    project_id: project_id || null,
    conversation_id: conversation_id || null,
    title: String(title).trim().slice(0, 200),
    content_json: JSON.stringify(contentDoc),
    content_text: contentText.slice(0, 50_000),
    category: 'brief',
    brief_meta: {
      view_kind: viewKind,
      sources: sources.map(s => ({ source: s.source, file_id: s.file_id || null })),
      timeline_count: timeline.length,
      by_file_count: byFile.length,
      recommended_next_kind: recommendedKind,
      recommended_next_reason: recommendedReason,
      summary,
      timeline,
      by_file: byFile,
      generated_at: new Date().toISOString(),
    },
    author_id: created_by,
  });

  // 6) 사용량 기록
  try {
    await cueOrch.recordUsage(
      business_id, 'brief', MODEL,
      data.usage?.prompt_tokens || 0,
      data.usage?.completion_tokens || 0,
    );
  } catch (e) { console.warn('[brief_service] recordUsage failed:', e.message); }

  return {
    post,
    brief_meta: post.brief_meta,
    recommended_next_kind: recommendedKind,
    recommended_next_reason: recommendedReason,
  };
}

// TipTap JSON 직렬화 — 사용자가 편집 가능한 문서 구조로
function buildTipTapDoc({ summary, viewKind, timeline, byFile }) {
  const content = [];
  if (summary) {
    content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '요약' }] });
    content.push({ type: 'paragraph', content: [{ type: 'text', text: summary }] });
  }
  if (viewKind === 'time' && timeline.length > 0) {
    content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '시점별 정리' }] });
    for (const item of timeline) {
      content.push({
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: `${item.when || ''} — ${item.title || ''}`.trim() }],
      });
      if (item.content) {
        content.push({ type: 'paragraph', content: [{ type: 'text', text: String(item.content) }] });
      }
      if (item.source) {
        content.push({
          type: 'paragraph',
          content: [{ type: 'text', text: `출처: ${item.source}`, marks: [{ type: 'italic' }] }],
        });
      }
    }
  }
  if (byFile.length > 0) {
    content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '자료별 정리' }] });
    for (const item of byFile) {
      content.push({
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: String(item.source || '') }],
      });
      if (item.summary) {
        content.push({ type: 'paragraph', content: [{ type: 'text', text: String(item.summary) }] });
      }
      if (Array.isArray(item.key_points) && item.key_points.length > 0) {
        content.push({
          type: 'bulletList',
          content: item.key_points.map(kp => ({
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: String(kp) }] }],
          })),
        });
      }
    }
  }
  return { type: 'doc', content };
}

function buildPlainText({ summary, viewKind, timeline, byFile }) {
  const parts = [];
  if (summary) parts.push(summary);
  if (viewKind === 'time' && timeline.length > 0) {
    parts.push('## 시점별');
    for (const item of timeline) {
      parts.push(`- ${item.when || ''} ${item.title || ''}: ${item.content || ''}`);
    }
  }
  if (byFile.length > 0) {
    parts.push('## 자료별');
    for (const item of byFile) {
      parts.push(`### ${item.source || ''}`);
      if (item.summary) parts.push(item.summary);
      if (Array.isArray(item.key_points)) parts.push(...item.key_points.map(p => `- ${p}`));
    }
  }
  return parts.join('\n');
}

module.exports = { buildAndCreatePost, extractFileText };
