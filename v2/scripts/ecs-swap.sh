#!/usr/bin/env bash
# 换 Web 容器，旧容器改名保留作回滚点。
#
# 这份脚本原来只存在于 ECS 上（d04-runs/swap-a56fee4-.../swap.sh），现在纳入仓库，
# 好处是它跟着发布一起被审阅和版本化。逻辑与那一版逐字相同，只加了一个可选参数：
#
#   HEALTH_MOUNTS（第 8 个参数，空格分隔）—— 健康模块的私有数据。只允许 :ro 挂载，唯一可写的是
#   /srv/nianlife-health/record（爸妈手记的账本）。同一时刻只能有一个运行中的容器挂着可写的 record：
#   切换是"先停旧容器、再起新容器"，起新容器之前和之后都会检查，不满足就回滚。数据目录在容器之外，
#   换容器、回滚都不会覆盖它。
#
#   MOUNT_SPEC（第 7 个参数）—— 形如 /host/path:/container/path:ro 的只读挂载。
#   九月的编辑稿要从仓库外的私有目录读，容器需要看得到它；除此之外没有别的用途。
#   不传就完全是原来的行为。
#
# env 文件仍然必须与源逐字节相同：要改运行时变量，就换一个新的源文件，而不是就地改目标。
set -euo pipefail
SRC="$1"; TARGET="$2"; SHORT="$3"; ROLLBACK_NAME="$4"; POLL_N="${5:-48}"; POLL_S="${6:-5}"; MOUNT_SPEC="${7:-}"; HEALTH_MOUNTS="${8:-}"
if [ -e "$TARGET" ]; then cmp -s "$SRC" "$TARGET" || { echo "STOP: $TARGET differs from $SRC"; exit 3; }; else cp -n -p "$SRC" "$TARGET"; fi
cmp -s "$SRC" "$TARGET" || { echo "STOP: copied env does not match source"; exit 3; }
rollback() {
  set +e
  echo "=== ROLLBACK === restoring $ROLLBACK_NAME as nianlife-diag-web"
  docker stop nianlife-diag-web >/dev/null 2>&1
  docker rm -f nianlife-diag-web >/dev/null 2>&1
  if docker rename "$ROLLBACK_NAME" nianlife-diag-web; then
    docker start nianlife-diag-web
    docker inspect nianlife-diag-web --format "ROLLED_BACK image={{.Config.Image}} status={{.State.Status}}"
    set -e
    return 0
  fi
  echo "ROLLBACK_RENAME_FAILED: starting the original container under its preserved name $ROLLBACK_NAME"
  docker start "$ROLLBACK_NAME"
  docker inspect "$ROLLBACK_NAME" --format "ROLLED_BACK_UNDER_PRESERVED_NAME image={{.Config.Image}} status={{.State.Status}}"
  set -e
  return 1
}
echo "=== SWAP === image nianlife-web:$SHORT env-file $TARGET rollback-container $ROLLBACK_NAME"
docker stop nianlife-diag-web
if ! docker rename nianlife-diag-web "$ROLLBACK_NAME"; then
  echo "STOP: rename failed; restarting the original container unchanged"
  docker start nianlife-diag-web || true
  exit 4
fi
mount_args=()
if [ -n "$MOUNT_SPEC" ]; then
  host_path="${MOUNT_SPEC%%:*}"
  [ -d "$host_path" ] || { echo "STOP: mount source $host_path does not exist"; docker start "$ROLLBACK_NAME" || true; exit 8; }
  case "$MOUNT_SPEC" in *:ro) ;; *) echo "STOP: mount must end in :ro"; docker start "$ROLLBACK_NAME" || true; exit 8 ;; esac
  mount_args=(-v "$MOUNT_SPEC")
  echo "MOUNT=$MOUNT_SPEC"
fi
HEALTH_RW="/srv/nianlife-health/record"
writers() { docker ps --format '{{.Names}}' | while read -r n; do docker inspect -f '{{range .Mounts}}{{if and .RW (eq .Source "'"$HEALTH_RW"'")}}{{println "W"}}{{end}}{{end}}' "$n" | grep -q W && echo "$n"; done; }
if [ -n "$HEALTH_MOUNTS" ]; then
  for spec in $HEALTH_MOUNTS; do
    host_path="${spec%%:*}"
    [ -d "$host_path" ] || { echo "STOP: health mount source $host_path does not exist"; docker start "$ROLLBACK_NAME" || true; exit 8; }
    case "$spec" in *:ro) ;; "$HEALTH_RW:$HEALTH_RW") ;; *) echo "STOP: health mounts must be :ro, except $HEALTH_RW"; docker start "$ROLLBACK_NAME" || true; exit 8 ;; esac
    mount_args+=(-v "$spec")
  done
  echo "HEALTH_MOUNTS=$HEALTH_MOUNTS"
  other=$(writers || true)
  if [ -n "$other" ]; then echo "STOP: another running container already holds the writable health record: $other"; docker start "$ROLLBACK_NAME" || true; exit 8; fi
fi
if ! docker run -d --name nianlife-diag-web --restart unless-stopped -p 127.0.0.1:3000:3000 --env-file "$TARGET" "${mount_args[@]}" "nianlife-web:$SHORT"; then
  echo "STOP: docker run failed"
  if rollback; then exit 5; else exit 7; fi
fi
healthy=0
for i in $(seq 1 "$POLL_N"); do
  H=$(docker inspect -f "{{.State.Health.Status}}" nianlife-diag-web 2>/dev/null || echo unknown)
  echo "t=${i} health=${H}"
  if [ "$H" = "healthy" ]; then healthy=1; break; fi
  sleep "$POLL_S"
done
if [ "$healthy" != "1" ]; then
  echo "STOP: nianlife-web:$SHORT not healthy after $((POLL_N * POLL_S))s"
  if rollback; then exit 6; else exit 7; fi
fi
if [ -n "$HEALTH_MOUNTS" ]; then
  w=$(writers || true)
  if [ "$w" != "nianlife-diag-web" ]; then echo "STOP: writable health record holders are '$w' (want exactly nianlife-diag-web)"; if rollback; then exit 6; else exit 7; fi; fi
  echo "SINGLE_WRITER=nianlife-diag-web"
fi
docker inspect nianlife-diag-web --format "POST_IMAGE={{.Config.Image}} POST_STATUS={{.State.Status}} POST_HEALTH={{.State.Health.Status}} POST_STARTED={{.State.StartedAt}}"
docker inspect nianlife-diag-web --format '{{range .Config.Env}}{{println .}}{{end}}' | { grep -E '^(ORGANIZER_WORKER_ENABLED|MEMORY_ORGANIZER|AI_MODEL|NIANLIFE_BUILD_SHA|MONTH_CONTENT_DIR)=' || true; } | sort -u
docker inspect nianlife-diag-web --format 'POST_MOUNTS={{range .Mounts}}{{.Source}}->{{.Destination}}(rw={{.RW}}) {{end}}' 
echo "SWAP_OK"
