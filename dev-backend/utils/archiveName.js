// utils/archiveName.js — 아카이브(zip) 엔트리 이름 정화.
//
// ★ 왜 — `File.file_name` 이 그대로 엔트리 이름이 되는데, 그 값이 **외부에서 온다.**
//   업로드 파일은 UUID 라 안전하지만 `services/emailImapCron.js` 는 **메일 첨부의 파일명을
//   그대로 저장**한다. 외부인이 `../../../../.ssh/authorized_keys` 라는 이름의 첨부를 보내면
//   그 값이 zip 안으로 들어간다(zip-slip — 압축을 푸는 쪽에서 경로를 벗어난다).
//   archiver 는 **선행 `../` 만** 제거한다 — 중간에 낀 것은 남는다.
//   (2026-09-02 보안감사 M-5. 문서 분기에는 같은 정화가 이미 세 줄 옆에 있었다.)
//
// ★ 제어문자는 **이스케이프 표기로만** 쓴다. 처음엔 정규식 안에 실제 NUL·제어문자를 박아 넣었는데
//   (주석엔 "코드포인트로 지정" 이라 써 놓고 정반대였다), NUL 이 든 소스는 grep·diff·가드가
//   **바이너리로 취급**해 조용히 건너뛴다. 눈에 안 보이는 바이트를 소스에 남기지 않는다.
function safeArchiveName(raw, fallback = 'file') {
  let n = String(raw || '').normalize('NFC');
  n = n.replace(/[\x00-\x1f\x7f]/g, '');   // 제어문자 (NUL·개행 등)
  n = n.replace(/[/\\]/g, '_');            // 경로 구분자 — 디렉터리를 만들 수 없게
  n = n.replace(/[:*?"<>|]/g, '_');        // 윈도우 금지문자
  n = n.trim().replace(/^\.+/, '_');       // 선행 점 (`..`, 숨김파일) — trim 뒤에 해야 " .hidden" 도 잡힌다
  n = n.slice(0, 150);
  return n || fallback;
}

module.exports = { safeArchiveName };
