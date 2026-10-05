# 목소리 프로필 → 화자 자동 이름 — 실호출 검사 (dev 전용, 수동)

docs/VOICE_PROFILE_DESIGN.md §6. **Deepgram 실시간·업로드를 실제로 쓴다**(회당 약 3분 분량) — 매일 밤 순찰에 넣지 않는다.

```bash
node scripts/e2e/voice/voice-live.js   # 마이크 모드 16검사 (워크스페이스 경계·미등록·본인·끄기·종료 배치·수동 보존·사람 고르기·삭제·감사)
node scripts/e2e/voice/voice-more.js   # 화상·공개 링크·열람자·업로드·탈퇴·보관기간·fail-closed 14검사
```

- 픽스처 `../fixtures/voice/*.wav` — Deepgram TTS 4목소리 × 서로 다른 문장 2 (16kHz mono). 사람 목소리가 아니다(동의 불필요).
- 지문은 `voice_fixture.py` 가 q-note SQLite 에 직접 넣는다 — 다른 계정으로 로그인하려고 비밀번호를 바꾸지 않기 위해서다.
- 끝나면 만든 세션·지문·임시 계정을 지운다.
