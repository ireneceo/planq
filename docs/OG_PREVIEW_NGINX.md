# SNS 링크 미리보기(OG) — nginx 적용 안내

운영 피드백 **#362** — "SNS에 웹링크 보낼 때 글이나 페이지 제목이 안 나오고 일반적인 홍보글만 나간다".

## 왜 nginx 를 건드려야 하는가

PlanQ 프론트는 SPA 라 모든 경로가 같은 `index.html` 을 받는다. 그 파일의 OG 태그는 **고정 문구**다.
카카오·슬랙·링크드인 같은 크롤러는 자바스크립트를 실행하지 않으므로, 프론트에서는 고칠 방법이 없다.

백엔드에 `routes/og.js` 를 만들어 **빌드된 index.html 을 읽어 og 태그만 치환**해 돌려주도록 했다.
남은 것은 **공개 경로만 그 백엔드로 넘기는 nginx 설정**이다. (root 권한 필요 — Irene 또는 lua 가 적용)

## 적용할 설정

`/etc/nginx/sites-available/dev.planq.kr` (운영은 `planq.kr`) 의 `location / { try_files ... }` **위에** 추가한다.
nginx 는 더 구체적인 prefix 를 먼저 매칭하므로 순서보다 prefix 가 우선이지만, 가독성상 위에 둔다.

```nginx
    # SNS 링크 미리보기(OG) 서버 렌더 — 공개 경로만 백엔드로. #362
    #   백엔드가 빌드된 index.html + og 태그 치환본을 돌려준다 (SPA 부팅은 그대로).
    location ~ ^/(insights/[^/]+|public/posts/[^/]+|public/docs/[^/]+)$ {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

> ⚠️ `/insights` (목록) 자체는 제외했다 — 목록은 고정 문구가 맞다. `:slug` 상세만 넘긴다.

`sites-enabled/` 는 **심볼릭 링크가 아니라 복사본**이다(2026-08-21 확인: `-rw-r--r-- root root`).
`sites-available` 만 고치면 반영되지 않는다. 반드시 둘 다 갱신한다.

```bash
sudo cp /etc/nginx/sites-available/dev.planq.kr /etc/nginx/sites-enabled/dev.planq.kr
sudo nginx -t && sudo systemctl reload nginx
```

## 적용 후 확인

```bash
# 실제 글 제목이 나와야 한다
curl -s https://dev.planq.kr/insights/create-workspace | grep -E '<title>|og:title|og:description'

# 없는 글은 기본 문구 그대로 (존재 여부를 흘리지 않는다)
curl -s https://dev.planq.kr/insights/does-not-exist-zzz | grep og:title
```

카카오톡·슬랙은 미리보기를 캐시한다. 이미 공유한 링크는 각 서비스의 캐시가 만료돼야 새 제목이 보인다
(카카오는 [디버거](https://developers.kakao.com/tool/debugger/sharing) 에서 강제 갱신 가능).

## 공개 범위 원칙 (코드에 박제됨)

- **제목 수준만** 노출한다. 금액·본문·첨부는 넣지 않는다 — 링크가 채팅방에 붙는 순간 참여자 전원이 본다.
- 대상을 못 찾으면 기본 index.html 을 **그대로** 돌려준다 (존재 여부조차 흘리지 않는다).
- 제목은 HTML 이스케이프한다. 반증 완료(2026-08-21): 제목에 `"` `<script>` 를 넣어도 원문 유출 0건.
