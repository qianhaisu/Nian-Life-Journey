#!/usr/bin/env bash
# nianlife.cn 公网上线：在本机（Git Bash）运行，通过 SSH 操作 ECS。沿用现有部署方式——
# Web 容器 nianlife-diag-web 由 docker run 启动、只发布 127.0.0.1:3000，切换时把旧容器改名保留作
# 回滚点；新增一个 host 网络的 Caddy 容器承接 80/443（配置见 Caddyfile.ecs）。
#
# 必需环境变量（不写默认值，防止误跑到别的机器）：
#   ECS_SSH=ecs-user@<ECS 公网 IP>   ECS_KEY=<ssh 私钥路径>   ECS_PUBLIC_IP=<DNS 应解析到的 IP>
#
# 子命令（每步独立执行，前一步确认无误再跑下一步）：
#   precheck                 只读：磁盘、当前容器、80/443 占用、两个域名的解析
#   upload <sha>             git archive v2 → ~/v2-deploy-<short>（不构建）
#   build <sha>              磁盘余量 ≥ MIN_FREE_MB 才构建 nianlife-web:<short>
#   swap <short>             换 Web 容器；旧容器改名 nianlife-diag-web-pre-<short>-<时间> 保留
#   caddy-up                 解析已指向 ECS_PUBLIC_IP 才启动 Caddy（自动申请证书）
#   verify                   本机外部验证：跳转、证书、首页、健康检查的 SHA
#   rollback-app <容器名>    把保留的旧 Web 容器改回 nianlife-diag-web 并启动
#   rollback-caddy           停 Caddy（保留容器与证书卷），80/443 回到关闭状态
#
# 不删除任何镜像、容器、卷或文件。
set -euo pipefail

: "${ECS_SSH:?set ECS_SSH=ecs-user@host}"
: "${ECS_KEY:?set ECS_KEY=path/to/key.pem}"
MIN_FREE_MB="${MIN_FREE_MB:-3000}"
MIN_FREE_AFTER_BUILD_MB="${MIN_FREE_AFTER_BUILD_MB:-1500}"
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2.10-alpine}"
ENV_SOURCE="${ENV_SOURCE:-/home/ecs-user/.env.runtime.a56fee4}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

remote() { ssh -o BatchMode=yes -o ConnectTimeout=15 -i "$ECS_KEY" "$ECS_SSH" bash -s -- "$@"; }
free_mb_remote='df -B1M --output=avail / | tail -1 | tr -d " "'

cmd="${1:-}"; shift || true
case "$cmd" in
  precheck)
    : "${ECS_PUBLIC_IP:?set ECS_PUBLIC_IP}"
    remote "$ECS_PUBLIC_IP" <<'EOF'
set -euo pipefail
echo "free_mb=$(df -B1M --output=avail / | tail -1 | tr -d ' ')"
docker inspect nianlife-diag-web --format 'web image={{.Config.Image}} health={{.State.Health.Status}} ports={{json .HostConfig.PortBindings}}'
docker exec nianlife-diag-web sh -c 'echo build_sha=$NIANLIFE_BUILD_SHA worker=$ORGANIZER_WORKER_ENABLED'
if ss -ltn '( sport = :80 or sport = :443 )' | grep -q LISTEN; then echo "ports 80/443: IN USE"; else echo "ports 80/443: free"; fi
docker ps -a --filter name=^nianlife-caddy$ --format 'caddy container: {{.Names}} {{.Status}}'
for h in nianlife.cn www.nianlife.cn; do echo "$h -> $(getent ahostsv4 "$h" | awk '{print $1}' | sort -u | tr '\n' ' ') (want $1)"; done
EOF
    ;;

  upload)
    sha="$(git -C "$REPO_ROOT" rev-parse --verify "${1:?usage: upload <sha>}^{commit}")"; short="${sha:0:7}"
    tar_local="$(mktemp -d)/v2-deploy-$short.tar"
    git -C "$REPO_ROOT" archive --format=tar -o "$tar_local" "$sha" v2
    ls -l "$tar_local"
    scp -o BatchMode=yes -i "$ECS_KEY" "$tar_local" "$ECS_SSH:/home/ecs-user/v2-deploy-$short.tar"
    remote "$short" <<'EOF'
set -euo pipefail
d="/home/ecs-user/v2-deploy-$1"
if [ -e "$d" ]; then echo "STOP: $d already exists"; exit 3; fi
mkdir "$d" && tar -xf "$d.tar" -C "$d"
du -sh "$d"
EOF
    ;;

  build)
    sha="$(git -C "$REPO_ROOT" rev-parse --verify "${1:?usage: build <sha>}^{commit}")"; short="${sha:0:7}"
    remote "$sha" "$short" "$MIN_FREE_MB" "$MIN_FREE_AFTER_BUILD_MB" <<'EOF'
set -euo pipefail
sha="$1"; short="$2"; min_before="$3"; min_after="$4"
free=$(df -B1M --output=avail / | tail -1 | tr -d ' ')
echo "free_mb_before=$free"
if [ "$free" -lt "$min_before" ]; then echo "STOP: free ${free}MB < ${min_before}MB, not building"; exit 3; fi
if docker image inspect "nianlife-web:$short" >/dev/null 2>&1; then echo "STOP: nianlife-web:$short already exists"; exit 3; fi
cd "/home/ecs-user/v2-deploy-$short/v2"
docker build --build-arg NIANLIFE_BUILD_SHA="$sha" -t "nianlife-web:$short" . > "/home/ecs-user/build-$short.log" 2>&1 || { tail -30 "/home/ecs-user/build-$short.log"; exit 4; }
tail -2 "/home/ecs-user/build-$short.log"
free=$(df -B1M --output=avail / | tail -1 | tr -d ' ')
echo "free_mb_after=$free"
if [ "$free" -lt "$min_after" ]; then echo "WARN: free ${free}MB < ${min_after}MB; stop before caddy-up and ask for cleanup approval"; exit 5; fi
EOF
    ;;

  swap)
    short="${1:?usage: swap <short>}"
    remote "$short" "$ENV_SOURCE" <<'EOF'
set -euo pipefail
short="$1"; env_src="$2"
ts=$(date +%Y%m%d-%H%M%S)
run="/home/ecs-user/d04-runs/swap-$short-$ts"
tmpl=/home/ecs-user/d04-runs/swap-a56fee4-20260915-082356/swap.sh
mkdir -p "$run"; cp -p "$tmpl" "$run/swap.sh"
docker image inspect "nianlife-web:$short" >/dev/null
bash "$run/swap.sh" "$env_src" "/home/ecs-user/.env.runtime.$short" "$short" "nianlife-diag-web-pre-$short-$ts" 2>&1 | tee "$run/swap.log"
echo "ROLLBACK_CONTAINER=nianlife-diag-web-pre-$short-$ts"
EOF
    ;;

  caddy-up)
    : "${ECS_PUBLIC_IP:?set ECS_PUBLIC_IP}"
    remote <<<'mkdir -p /home/ecs-user/nianlife-caddy'
    scp -o BatchMode=yes -i "$ECS_KEY" "$REPO_ROOT/v2/Caddyfile.ecs" "$ECS_SSH:/home/ecs-user/nianlife-caddy/Caddyfile"
    remote "$ECS_PUBLIC_IP" "$CADDY_IMAGE" "${SKIP_DNS_CHECK:-0}" <<'EOF'
set -euo pipefail
ip="$1"; image="$2"; skip_dns="$3"
for h in nianlife.cn www.nianlife.cn; do
  got=$(getent ahostsv4 "$h" | awk '{print $1}' | sort -u | tr '\n' ' ' || true)
  if [ "$got" = "$ip " ]; then continue; fi
  if [ "$skip_dns" = "1" ]; then echo "WARN: $h resolves to '$got'; starting anyway (SKIP_DNS_CHECK=1). After DNS is added run: docker restart nianlife-caddy"; continue; fi
  echo "STOP: $h resolves to '$got', want $ip (DNS first, grey cloud)"; exit 3
done
if ss -ltn '( sport = :80 or sport = :443 )' | grep -q LISTEN; then echo "STOP: 80/443 already in use"; exit 3; fi
if docker ps -a --format '{{.Names}}' | grep -qx nianlife-caddy; then echo "STOP: nianlife-caddy exists; use docker start nianlife-caddy"; exit 3; fi
curl -s -o /dev/null -m 5 -w "upstream 127.0.0.1:3000 -> %{http_code}\n" http://127.0.0.1:3000/api/health
docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image"
docker run --rm -v /home/ecs-user/nianlife-caddy/Caddyfile:/etc/caddy/Caddyfile:ro "$image" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker run -d --name nianlife-caddy --network host --restart unless-stopped \
  -v /home/ecs-user/nianlife-caddy/Caddyfile:/etc/caddy/Caddyfile:ro \
  -v nianlife-caddy-data:/data -v nianlife-caddy-config:/config "$image"
sleep 20
docker logs --tail 40 nianlife-caddy 2>&1 | grep -E 'certificate obtained|error|obtain|listening' || true
EOF
    ;;

  verify)
    c() { curl --noproxy '*' -s -o /dev/null -m 20 "$@"; }
    c -w "http://nianlife.cn/        %{http_code} -> %{redirect_url}\n" http://nianlife.cn/
    c -w "http://www.nianlife.cn/x   %{http_code} -> %{redirect_url}\n" "http://www.nianlife.cn/x?y=1"
    c -w "https://www.nianlife.cn/x  %{http_code} -> %{redirect_url}\n" "https://www.nianlife.cn/x?y=1"
    c -w "https://nianlife.cn/       %{http_code} %{time_total}s\n" https://nianlife.cn/
    curl --noproxy '*' -s -m 20 https://nianlife.cn/api/health; echo
    curl --noproxy '*' -s -m 20 https://nianlife.cn/ | grep -o '浙ICP备[0-9]*号-[0-9]*' | head -1
    for h in nianlife.cn www.nianlife.cn; do
      echo | openssl s_client -connect "$h:443" -servername "$h" 2>/dev/null | openssl x509 -noout -subject -issuer -enddate
    done
    ;;

  rollback-app)
    name="${1:?usage: rollback-app <nianlife-diag-web-pre-...>}"
    remote "$name" <<'EOF'
set -euo pipefail
name="$1"
docker inspect "$name" --format 'restoring {{.Name}} image={{.Config.Image}}'
failed="nianlife-diag-web-failed-$(date +%Y%m%d-%H%M%S)"
docker stop nianlife-diag-web && docker rename nianlife-diag-web "$failed"
docker rename "$name" nianlife-diag-web && docker start nianlife-diag-web
for i in $(seq 1 24); do h=$(docker inspect -f '{{.State.Health.Status}}' nianlife-diag-web); echo "t=$i health=$h"; [ "$h" = healthy ] && break; sleep 5; done
echo "kept failed container as $failed"
EOF
    ;;

  rollback-caddy)
    remote <<'EOF'
set -euo pipefail
docker stop nianlife-caddy
docker ps -a --filter name=^nianlife-caddy$ --format '{{.Names}} {{.Status}} (container and volumes kept)'
EOF
    ;;

  *) sed -n '2,22p' "$0"; exit 2 ;;
esac
