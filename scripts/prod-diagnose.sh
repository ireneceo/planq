#!/bin/bash
# PlanQ 운영 진입 — 운영서버 환경 진단
# 운영서버에서 한 번 실행. 결과를 그대로 dev 서버 Claude 에 붙여넣으면 충돌 회피 설계됨.

set +e
hr() { printf '\n\033[34m═══ %s ═══\033[0m\n' "$1"; }

hr "1. OS / 자원"
uname -a
echo "CPU: $(nproc) cores"
free -h | head -2
df -h / 2>/dev/null | tail -1

hr "2. PM2 (떠있는 앱)"
pm2 list 2>&1 | tail -20

hr "3. 점유 포트 (PlanQ 가 쓰려는 80/443/3002/8001/3306 + 자주 쓰는 다른 포트)"
sudo ss -tlnp 2>/dev/null | grep -E ':(80|443|3000|3001|3002|3003|3306|5432|6379|8000|8001|8080|9000) ' \
  || ss -tlnp 2>/dev/null | grep -E ':(80|443|3000|3001|3002|3003|3306|5432|6379|8000|8001|8080|9000) '

hr "4. nginx sites-enabled"
ls /etc/nginx/sites-enabled/ 2>/dev/null
echo "--- 현재 도메인 매핑 ---"
sudo nginx -T 2>/dev/null | grep -E '^\s*server_name\s+' | sort -u | head -20

hr "5. MySQL"
sudo mysql -e "SELECT VERSION() AS version; SHOW DATABASES; SELECT user, host FROM mysql.user;" 2>&1 | head -30
[ $? -ne 0 ] && echo "(sudo mysql 실패 — root password 또는 socket 문제. mysql -uroot -p 로 수동 확인)"

hr "6. Node / npm / Python / git / certbot"
echo -n "node: "; node -v 2>&1 || echo "(없음 — nvm 또는 apt 로 설치 필요. 18+ 권장)"
echo -n "npm: "; npm -v 2>&1
echo -n "python3: "; python3 --version 2>&1
echo -n "pip: "; pip3 --version 2>&1 | head -1
echo -n "git: "; git --version 2>&1
echo -n "certbot: "; certbot --version 2>&1

hr "7. 디스크 사용 — POS 디렉터리 확인 (PlanQ 도 여기 옆에 깔지)"
ls -la /var/www 2>/dev/null
ls -la /opt 2>/dev/null

hr "8. 도메인 DNS — planq.kr 이 이 서버를 가리키는지"
echo -n "외부 IP: "; curl -s ifconfig.me; echo
echo -n "planq.kr resolved: "; dig +short planq.kr A | tail -1
echo -n "www.planq.kr resolved: "; dig +short www.planq.kr A | tail -1

hr "9. Github SSH"
ls -la ~/.ssh/ 2>/dev/null | head
echo "--- known_hosts 에 github 있는지 ---"
grep -c 'github.com\|github-planq' ~/.ssh/known_hosts 2>/dev/null

hr "완료"
echo "결과를 그대로 dev 서버 Claude 에 붙여넣으세요."
