# video-engine — PlanQ 시연·홍보 영상 엔진 (dev 전용 · A단계 시제품)

엔진은 하나이고, 생성 방식 3가지(① 녹음 기반 ② 지시만 ③ 브랜딩)는 **대본(장면 목록)만 다르게** 만든다.

```
녹화(capture/record.js) ─┐                       ┌─ templates/*.json (편집 규칙)
                         ├→ 대본 storyboards/*.json ─→ build/storyboard.js ─→ 장면 목록 out/storyboards/*.json ─→ render.js ─→ out/renders/<id>-16x9.mp4 · -9x16.mp4
AI 대본(ai/script.js) ───┘     (관리자가 확인·수정)        (카메라·커서·자막 시각·박자)                (Remotion, 한 편씩·메모리 게이트)
참고 영상 ─→ analyze/template-from-video.js ─→ templates/<id>.json
```

| 경로 | 하는 일 |
|---|---|
| `capture/record.js` | 데모 워크스페이스(온무늬)를 puppeteer 로 조작하며 **깨끗한 화면만** 2배(휴대폰 3배) 해상도로 녹화 + 커서·클릭·강조·기다림을 `shot.json` 에 기록. 자막·커서는 굽지 않는다 |
| `capture/catalog.json` | 녹화 장면 목록(설명·자막 자리) — AI 대본이 읽는다 |
| `ai/script.js` | 지시/브랜딩 요청 → 대본 JSON (llm.js · 랜딩 문구 사실만 · 녹화 장면 id·자막 자리 검사) |
| `build/storyboard.js` | 대본 → 장면 목록(원본 시각→출력 시각, 기다림 빨리 감기, 카메라 키 가로/세로, 장면 경계를 음악 박자에, 효과음) |
| `src/` | Remotion — 같은 장면 목록을 가로 1920×1080 · 세로 1080×1920 으로 그림 |
| `analyze/template-from-video.js` | 참고 영상 → 템플릿(컷 길이·박자 일치·색감 실측 + AI 이미지 인식으로 자막·카메라·전환 스타일) |
| `templates/` | 편집 규칙. 집 기본형 3종(calm-lecture · fast-shorts · emotional-brand) + 참고 영상에서 만든 것 |
| `lib/` | ffmpeg 도우미 · 박자 분석 · 효과음 합성 |

처음: `npm ci && npx remotion browser ensure && node setup.js` (글꼴·로고·효과음·음악)

실행 예:
```bash
node capture/record.js                       # 녹화 (선행: node dev-backend/scripts/seed-demo-workspace.js)
node ai/script.js --mode=instruction --template=fast-shorts --music=Pamgaea --id=x "지시문"
node build/storyboard.js storyboards/x.json
node render.js out/storyboards/x.json        # [--only=portrait] [--still=12.5]
```

라이선스: Remotion — 3명 이하 회사 무료(회사 라이선스 조건). 임시 음악 Kevin MacLeod CC BY 4.0(영상 설명에 출처 표기 필요 — catalog 의 credit).
