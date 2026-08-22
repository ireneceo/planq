# [운영서버 작업 요청] SNS 링크 미리보기 nginx 적용 — #362

> 운영서버(87.106.78.146)에서 실행할 것. **sudo 필요** — dev 세션의 Opus 는 sudo 비밀번호가 없어 못 한다(2026-08-22 실측: `sudo -n` 거부, `/etc/nginx/` root 소유).
> 코드는 이미 배포돼 있다. 남은 것은 **크롤러 요청을 백엔드로 넘기는 nginx 설정 한 블록**뿐이다.

## 지금 상태

- 백엔드에 `routes/og.js` 가 있고 운영에 배포됨 — 빌드된 `index.html` 을 읽어 og 태그만 치환해 돌려준다.
- 그런데 nginx 가 그 경로를 **정적 파일로 처리**해서, 크롤러(카카오·슬랙·링크드인)는 여전히 고정 홍보 문구를 받는다.
- 크롤러는 자바스크립트를 실행하지 않으므로 프론트에서는 고칠 방법이 없다.

## 할 일 (3단계)

### 1. 설정 추가

`/etc/nginx/sites-available/planq.kr` 의 `location / { try_files ... }` **위에** 아래 블록을 넣는다.

```nginx
    # SNS 링크 미리보기(OG) 서버 렌더 — 공개 경로만 백엔드로. #362
    #   백엔드가 빌드된 index.html + og 태그 치환본을 돌려준다 (SPA 부팅은 그대로).
    #   ★ 운영 백엔드 포트는 3004 다 (dev 3003 아님).
    location ~ ^/(insights/[^/]+|public/posts/[^/]+|public/docs/[^/]+)$ {
        proxy_pass http://127.0.0.1:3004;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

`/insights` 목록 자체는 제외한다 — 목록은 고정 문구가 맞다. `:slug` 상세만 넘긴다.

### 2. 반영

**`sites-enabled/planq.kr` 는 심볼릭 링크다**(2026-08-22 확인: `planq.kr -> ../sites-available/planq.kr`).
따라서 `sites-available` 만 고치면 되고 복사는 필요 없다. (dev 서버는 복사본이라 다르다 — 헷갈리지 말 것.)

```bash
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` 가 실패하면 **reload 하지 말 것.** 문법 오류 그대로 두면 다음 재시작 때 nginx 가 안 뜬다.

### 3. 확인

```bash
# ★ 사람이 아니라 **크롤러** UA 로 확인해야 한다 — 미리보기를 만드는 쪽이 크롤러다.
#   사람 UA 로만 확인하다가 #362 가 절반만 된 것을 못 봤다(#373).
curl -s -A 'Kakaotalk-scrap' https://planq.kr/insights/create-workspace | grep og:title
```

```bash
# 실제 글 제목이 나와야 한다
curl -s https://planq.kr/insights/create-workspace | grep -E '<title>|og:title|og:description'

# 없는 글은 기본 문구 그대로 (존재 여부를 흘리지 않는다)
curl -s https://planq.kr/insights/does-not-exist-zzz | grep og:title

# SPA 도 그대로 떠야 한다 — 사람이 브라우저로 열었을 때 화면이 정상인지 눈으로 확인
```

## 되돌리기

블록을 지우고 `sudo nginx -t && sudo systemctl reload nginx`. 백엔드는 건드리지 않았으므로 그것만으로 원상복구된다.

## 운영에서 추가로 필요한 env — **없음** (2026-08-22 코드 수정 후)

이 절을 남기는 이유: 처음 이 문서는 "코드는 이미 배포돼 있다, 남은 것은 nginx 한 블록뿐" 이라고 적었는데
**실제로는 운영 `.env` 항목이 하나 더 필요했다.** `routes/og.js` 가 SPA index 경로를 `dev-frontend-build` 로
하드코딩하고 있어서, nginx 가 그 경로를 백엔드로 넘긴 순간 `/insights/:slug` 가 사람·크롤러 모두 404 로 죽었다(#374).
설정 한 줄이 기능 추가가 아니라 페이지 다운이 된 것이다.

지금은 `routes/og.js` 가 후보 경로를 순서대로 찾고(`SPA_INDEX_PATH` → `FRONTEND_INDEX_HTML` →
`frontend-build` → `dev-frontend-build`), 어느 것도 없으면 404 대신 `next()` 로 정적 서빙에 넘긴다.
따라서 **운영에 env 를 넣지 않아도 동작하고, env 누락이 장애가 되지 않는다.**
운영 `.env` 에 이미 들어가 있는 `SPA_INDEX_PATH` 는 그대로 둬도 무해하다(첫 후보로 쓰인다).

> dev→운영 인계 문서를 쓸 때는 **운영에서만 다른 경로·포트·env** 를 항상 한 절로 따로 적을 것.
> 이번 건은 "포트 3004" 는 적었지만 빌드 디렉토리 차이를 적지 않아 장애가 났다.

## 주의

- 카카오·슬랙은 미리보기를 **캐시한다.** 이미 공유한 링크는 캐시가 만료돼야 새 제목이 보인다
  (카카오는 [디버거](https://developers.kakao.com/tool/debugger/sharing) 에서 강제 갱신 가능).
- 공개 범위는 코드에 박제돼 있다 — **제목 수준만** 나간다. 금액·본문·첨부는 넣지 않는다.
  링크가 채팅방에 붙는 순간 참여자 전원이 보기 때문이다.
- 적용 후 운영 피드백 **#362 를 닫고 답글**을 달아야 처리된 것이다(답글 없이 닫으면 무시당한 것과 같다).
