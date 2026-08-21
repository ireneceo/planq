// 첨부 허용 확장자 — **단일 원천**.
//
// 운영 #267 — "모바일에서 파일 첨부하는 거 왜 비디오는 못해? 모든 첨부하는 기능 통일된 상태고
//   모바일에서 비디오도 올라가는 거 맞는지 체크해줘."
//
//   확인해 보니 통일돼 있지 않았다. 같은 목록이 두 라우트에 각각 하드코딩돼 있었고 내용이 달랐다:
//     - routes/message_attachments.js (채팅) : 영상·음성 포함
//     - routes/task_attachments.js   (업무)  : 영상·음성 **없음** → 업무에 동영상을 붙이면
//                                              disallowed_extension 으로 거절
//   사용자에겐 "어떤 화면에서는 되고 어떤 화면에서는 안 되는" 것으로 보인다. 목록을 여기 하나로 모은다.
//   (워크스페이스 파일 업로드 routes/files.js 는 확장자 제한 없이 용량만 본다 — 가장 넓은 문이라
//    여기 목록이 그보다 좁은 것은 의도된 것이다. 첨부는 대화·업무 맥락에 붙는 것이라 범위를 좁게 둔다.)
const ATTACHMENT_EXT = new Set([
  // 이미지
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.heic', '.heif',
  // 문서
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.txt', '.md', '.csv',
  // 영상 — Drive 연동 시 5GB 까지, 자체 스토리지 시 플랜의 파일당 한도까지
  //   (거절되면 형식이 아니라 **용량** 이 이유다 — plan.js 가 숫자를 적어 안내한다)
  '.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v',
  // 음성
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac',
]);

module.exports = { ATTACHMENT_EXT };
