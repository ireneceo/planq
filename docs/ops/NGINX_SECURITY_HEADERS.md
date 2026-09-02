# nginx 보안 헤더 — 앱 HTML 에 적용 (2026-09-02 보안감사 H-1)

## 무엇이 문제인가

**앱 화면(HTML)에는 보안 헤더가 하나도 붙지 않는다.** 실측:

```
$ curl -sSI https://dev.planq.kr/talk
HTTP/2 200
server: nginx/1.24.0 · content-type: text/html · cache-control: no-cache
(CSP 없음 · X-Frame-Options 없음 · HSTS 없음 · nosniff 없음)

$ curl -sSI https://dev.planq.kr/api/health
content-security-policy: default-src 'self'; …; script-src 'self' …
x-frame-options: DENY · strict-transport-security: … · x-content-type-options: nosniff
```

원인: `middleware/security.js:112` 가 `/api/` 로 시작하지 않는 경로에서 곧장 `next()` 하고,
정적 파일은 **nginx 가 직접 서빙**(`try_files … /index.html`)하므로 Express 를 아예 거치지 않는다.
결과적으로 공들여 만든 CSP 가 **JSON 응답에만** 붙는다.

영향:
- 앱 전체가 **클릭재킹 가능**(iframe 삽입 차단 없음)
- 저장형 XSS 가 나올 때 **완화 장치가 0** (같은 감사의 H-3 와 곱해진다)
- HSTS 없음 — 첫 접속 다운그레이드

## 적용 (root 권한 필요 — Irene 또는 lua)

`/etc/nginx/sites-enabled/dev.planq.kr` 의 `location /` (또는 `try_files` 가 있는 블록)에 추가.
**운영(`planq.kr`)에도 같은 내용을 넣어야 한다** — 감사 지시상 운영 nginx 는 확인하지 않았다.

```nginx
    # 보안 헤더 — 앱 HTML 에 붙인다 (백엔드 helmet 은 /api/ 응답에만 적용된다).
    #   ★ add_header 는 블록마다 상속이 끊긴다 — location 을 새로 만들면 여기서 복사해 갈 것.
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' wss: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Permissions-Policy "camera=(self), microphone=(self), geolocation=()" always;
```

> **CSP 값은 백엔드(`middleware/security.js` 의 `cspMiddleware`)와 같은 값으로 유지한다.**
> 두 벌이 되면 반드시 갈라진다 — 백엔드를 고치면 이 파일도 같이 고칠 것.

### 적용 절차

```bash
sudo nano /etc/nginx/sites-enabled/dev.planq.kr      # 위 블록 추가
sudo nginx -t                                        # 문법 검사 — 반드시 통과 확인
sudo systemctl reload nginx
```

### 적용 후 검증 (이게 통과해야 완료)

```bash
curl -sSI https://dev.planq.kr/talk | grep -iE 'content-security-policy|x-frame-options|strict-transport|nosniff'
# 4줄이 모두 나와야 한다. 하나라도 없으면 add_header 가 다른 location 에 가려진 것.

curl -sSI https://dev.planq.kr/assets/index-*.js | grep -ic 'x-content-type-options'
# /assets/ 블록이 따로 있으면 거기에도 복사해야 1 이 나온다.
```

### 주의

- `add_header` 는 **하위 블록에서 하나라도 add_header 를 쓰면 상위 것이 전부 사라진다.**
  `/assets/`, `/.well-known/`, `/qnote/` 처럼 별도 location 이 있으면 각각에 복사할 것.
- `always` 를 빼면 4xx/5xx 응답에는 헤더가 안 붙는다 — 오류 페이지도 같은 보호가 필요하다.
- CSP 를 켠 뒤 **OAuth 팝업·PDF 미리보기·지도 등 외부 리소스 화면을 한 번씩 눌러 볼 것.**
  콘솔에 `Refused to load` 가 뜨면 그 출처를 지시문에 추가한다(전체 완화 금지).
