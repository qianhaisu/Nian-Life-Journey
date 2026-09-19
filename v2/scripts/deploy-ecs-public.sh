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
#   content-install <月> <文件>  装一个月的编辑稿：版本化文件 + 同文件系统内原子替换
#   content-rollback <月> <版本文件名>|--withdraw
#                            撤回一个月的编辑稿：指回 versions/ 里的某个旧版本，或整月撤下（软链改名保留，
#                            页面回到没有编辑稿时的原样）。不删除任何版本文件。
#   swap <short>             换 Web 容器；旧容器改名 nianlife-diag-web-pre-<short>-<时间> 保留
#   caddy-up                 解析已指向 ECS_PUBLIC_IP 才启动 Caddy（自动申请证书）
#   verify                   本机外部验证：跳转、证书、首页、健康检查的 SHA
#   rollback-app <容器名>    把保留的旧 Web 容器改回 nianlife-diag-web 并启动
#   rollback-caddy           停 Caddy（保留容器与证书卷），80/443 回到关闭状态
#
# 成功切换后自动保留最近两版回滚，清理更早容器及无引用镜像/缓存；不删除数据卷或内容。
set -euo pipefail

: "${ECS_SSH:?set ECS_SSH=ecs-user@host}"
: "${ECS_KEY:?set ECS_KEY=path/to/key.pem}"
MIN_FREE_MB="${MIN_FREE_MB:-3000}"
MIN_FREE_AFTER_BUILD_MB="${MIN_FREE_AFTER_BUILD_MB:-1500}"
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2.10-alpine}"
ENV_SOURCE="${ENV_SOURCE:-/home/ecs-user/.env.runtime.a56fee4}"
# 编辑稿放在仓库外的私有目录，只读挂进容器。留空则完全是原来的行为（没有挂载）。
CONTENT_HOST_DIR="${CONTENT_HOST_DIR:-/srv/nianlife-content}"
CONTENT_MOUNT="${CONTENT_MOUNT:-$CONTENT_HOST_DIR:$CONTENT_HOST_DIR:ro}"
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
exec 9>/home/ecs-user/.nianlife-deploy.lock
flock -n 9 || { echo "STOP: another deployment is active"; exit 9; }
free=$(df -B1M --output=avail / | tail -1 | tr -d ' ')
echo "free_mb_before=$free"
if [ "$free" -lt "$min_before" ]; then echo "STOP: free ${free}MB < ${min_before}MB, not building"; exit 3; fi
if docker image inspect "nianlife-web:$short" >/dev/null 2>&1; then echo "STOP: nianlife-web:$short already exists"; exit 3; fi
cd "/home/ecs-user/v2-deploy-$short/v2"
docker build --build-arg NIANLIFE_BUILD_SHA="$sha" -t "nianlife-web:$short" . > "/home/ecs-user/build-$short.log" 2>&1 || { tail -30 "/home/ecs-user/build-$short.log"; exit 4; }
tail -2 "/home/ecs-user/build-$short.log"
free=$(df -B1M --output=avail / | tail -1 | tr -d ' ')
echo "free_mb_after=$free"
if [ "$free" -lt "$min_after" ]; then echo "WARN: free ${free}MB < ${min_after}MB; stop and apply docs/ecs-retention-policy.md before proceeding"; exit 5; fi
EOF
    ;;

  content-install)
    # 一个月的编辑稿。版本化保存，校验通过后在同一文件系统内原子替换 current 软链。
    month="${1:?usage: content-install <YYYY-MM> <local file>}"; src="${2:?usage: content-install <YYYY-MM> <local file>}"
    [ -f "$src" ] || { echo "STOP: $src not found"; exit 2; }
    stamp="$(date +%Y%m%d-%H%M%S)"
    scp -o BatchMode=yes -i "$ECS_KEY" "$src" "$ECS_SSH:/tmp/$month.$stamp.json.tmp"
    remote "$month" "$stamp" "$CONTENT_HOST_DIR" <<'EOF'
set -euo pipefail
month="$1"; stamp="$2"; dir="$3"
sudo mkdir -p "$dir/versions"
tmp="/tmp/$month.$stamp.json.tmp"
# 按加载器实际要求校验：schema、month、days 为非空数组，且每天都有必需字段。
# 用宿主机的 python3（ECS 上没有装 node，node 只在容器里）。
python3 - "$tmp" "$month" <<'PYEOF'
import json, re, sys
path, month = sys.argv[1], sys.argv[2]
def bad(msg):
    print("INVALID: " + msg); sys.exit(3)
d = json.load(open(path, encoding="utf-8"))
if d.get("schema") != "nianlife.month-content/1": bad("schema")
if d.get("month") != month: bad("month mismatch")
days = d.get("days")
if not isinstance(days, list) or not days: bad("days")
for x in days:
    if not isinstance(x, dict): bad("day not an object")
    k = x.get("day", "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", k or ""): bad("day key " + str(k))
    if not k.startswith(month + "-"): bad("day outside month: " + k)
    if x.get("kind") not in ("story", "visual-description", "text-only"): bad("kind on " + k)
    for f in ("paragraphs", "firstScreenMediaIds", "expandedMediaIds"):
        if not isinstance(x.get(f), list): bad(f + " on " + k)
    exp = set(x["expandedMediaIds"])
    if not all(i in exp for i in x["firstScreenMediaIds"]): bad("first screen not a subset on " + k)
print("VALID days=%d cover=%s speakers=%d" % (
    len(days), "yes" if d.get("coverMediaId") else "no", len(d.get("speakerBySourceId") or {})))
PYEOF
ver="$dir/versions/$month.$stamp.json"
sudo cp "$tmp" "$ver"; rm -f "$tmp"
sudo chmod 0644 "$ver"; sudo chmod 0755 "$dir" "$dir/versions"
# 同一文件系统内的原子替换：先写同目录的临时软链，再 mv 覆盖。
sudo ln -sfn "$ver" "$dir/.$month.json.new"
sudo mv -T "$dir/.$month.json.new" "$dir/$month.json"
ls -l "$dir/$month.json"; ls -1 "$dir/versions" | tail -5
echo "CONTENT_VERSION=$month.$stamp.json"
EOF
    ;;

  content-rollback)
    # The way back from content-install, mechanised so it is not a hand-typed sudo line on release day.
    # A named version must already sit in versions/ (nothing is uploaded here). --withdraw renames the
    # month's link aside instead of deleting it, so the page falls back to its unedited layout and the
    # link can be put back by hand. Call /api/internal/revalidate afterwards, as after an install.
    month="${1:?usage: content-rollback <YYYY-MM> <version file>|--withdraw}"; target="${2:?usage: content-rollback <YYYY-MM> <version file>|--withdraw}"
    [[ "$month" =~ ^[0-9]{4}-[0-9]{2}$ ]] || { echo "STOP: month must be YYYY-MM"; exit 2; }
    remote "$month" "$target" "$CONTENT_HOST_DIR" "$(date +%Y%m%d-%H%M%S)" <<'EOF'
set -euo pipefail
month="$1"; target="$2"; dir="$3"; stamp="$4"
[ -e "$dir/$month.json" ] || [ -L "$dir/$month.json" ] || { echo "STOP: $dir/$month.json does not exist"; exit 3; }
echo "before: $(ls -l "$dir/$month.json")"
if [ "$target" = "--withdraw" ]; then
  sudo mv -T "$dir/$month.json" "$dir/.$month.json.withdrawn-$stamp"
  echo "withdrawn: $month now has no edited content (link kept as .$month.json.withdrawn-$stamp)"
else
  case "$target" in */*|.*) echo "STOP: give a file name inside versions/, not a path"; exit 3;; esac
  [ -f "$dir/versions/$target" ] || { echo "STOP: versions/$target not found"; exit 3; }
  case "$target" in "$month".*) ;; *) echo "STOP: $target is not a version of $month"; exit 3;; esac
  sudo ln -sfn "$dir/versions/$target" "$dir/.$month.json.new"
  sudo mv -T "$dir/.$month.json.new" "$dir/$month.json"
  echo "after: $(ls -l "$dir/$month.json")"
fi
ls -1 "$dir/versions" | grep "^$month\." | tail -5
EOF
    ;;

  swap)
    short="${1:?usage: swap <short>}"
    scp -o BatchMode=yes -i "$ECS_KEY" "$SCRIPT_DIR/ecs-swap.sh" "$ECS_SSH:/home/ecs-user/ecs-swap.sh"
    scp -o BatchMode=yes -i "$ECS_KEY" "$SCRIPT_DIR/ecs-retention.py" "$ECS_SSH:/home/ecs-user/ecs-retention.py"
    remote "$short" "$ENV_SOURCE" "$CONTENT_MOUNT" <<'EOF'
set -euo pipefail
short="$1"; env_src="$2"; mount_spec="$3"
exec 9>/home/ecs-user/.nianlife-deploy.lock
flock -n 9 || { echo "STOP: another deployment is active"; exit 9; }
ts=$(date +%Y%m%d-%H%M%S)
run="/home/ecs-user/d04-runs/swap-$short-$ts"
mkdir -p "$run"; cp -p /home/ecs-user/ecs-swap.sh "$run/swap.sh"
docker image inspect "nianlife-web:$short" >/dev/null
bash "$run/swap.sh" "$env_src" "/home/ecs-user/.env.runtime.$short" "$short" "nianlife-diag-web-pre-$short-$ts" 48 5 "$mount_spec" 2>&1 | tee "$run/swap.log"
echo "ROLLBACK_CONTAINER=nianlife-diag-web-pre-$short-$ts"
if ! python3 /home/ecs-user/ecs-retention.py --apply 2>&1 | tee "$run/retention.log"; then
  echo "RETENTION_FAILED: new release is running; maintenance is incomplete (do not roll back automatically)"
  exit 10
fi
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
exec 9>/home/ecs-user/.nianlife-deploy.lock
flock -n 9 || { echo "STOP: another deployment is active"; exit 9; }
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
