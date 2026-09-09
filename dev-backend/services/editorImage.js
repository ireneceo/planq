// services/editorImage.js — 에디터 업로드 이미지 한 장을 내보내도 되는가, **술어 하나**.
//
// 왜 뽑았나 (2026-09-09):
//   `GET /api/posts/editor-image/:filename` 안에만 있던 판정을 PDF 렌더러도 써야 한다.
//   베껴 두면 갈라진다 — 2026-09-01 Fable 게이트가 이 라우트에 넣은 네 가지 검사
//   (File 행 근거 · deleted_at · security_level · DB 가 아는 MIME)가 한쪽에만 남는 순간
//   PDF 로는 지운 이미지·대외비 이미지가 나가게 된다.
//   주석으로 "같은 술어" 라고 적는 것은 검증되지 않는다. **같은 함수를 부르게 한다.**
const path = require('path');
const fs = require('fs');
const { Op } = require('sequelize');
const { File } = require('../models');

const EDITOR_IMG_DIR = path.join(__dirname, '..', 'uploads', 'editor-images');
// path traversal 방어 + 확장자 화이트리스트 (라우트가 쓰던 것 그대로)
const EDITOR_IMG_NAME_RE = /^[0-9a-f-]+\.(png|jpe?g|gif|webp|svg)$/i;

/**
 * 파일명 하나를 판정한다. 내보내도 되면 { file, absPath, mime }, 아니면 null.
 * 호출부는 null 을 "없음" 으로 다룬다 — 존재 은닉(404)이 이 계열의 계약이다.
 */
async function resolveEditorImage(filename) {
  const name = String(filename || '');
  if (!EDITOR_IMG_NAME_RE.test(name)) return null;

  // ★ LIKE 는 접미사 매칭이라 짧은 값으로 남의 파일이 걸린다 — basename 정확 일치까지 본다.
  const row = await File.findOne({
    where: { file_path: { [Op.like]: `%editor-images/${name}` }, deleted_at: null },
  });
  const file = row && path.basename(row.file_path) === name ? row : null;
  if (!file) return null;

  // 대외비·내부용은 무인증 경로로 절대 내보내지 않는다.
  if (file.security_level && file.security_level !== 'general') return null;

  // image/* 만 — HTML/JS 를 inline 으로 흘리면 XSS 가 된다.
  const { isRenderableImage } = require('./filePreview');
  if (!isRenderableImage(file.mime_type)) return null;

  const absPath = path.join(EDITOR_IMG_DIR, name);
  if (!fs.existsSync(absPath)) return null;

  return { file, absPath, mime: file.mime_type };
}

module.exports = { resolveEditorImage, EDITOR_IMG_DIR, EDITOR_IMG_NAME_RE };
