#!/usr/bin/env bash
# 换 Web 容器，旧容器改名保留作回滚点。
#
# 这份脚本原来只存在于 ECS 上（d04-runs/swap-a56fee4-.../swap.sh），现在纳入仓库，
# 好处是它跟着发布一起被审阅和版本化。逻辑与那一版逐字相同，只加了一个可选参数：
#
#   MOUNT_SPEC（第 7 个参数）—— 形如 /host/path:/container/path:ro 的只读挂载。
#   九月的编辑稿要从仓库外的私有目录读，容器需要看得到它；除此之外没有别的用途。
#   不传就完全是原来的行为。
#
# env 文件仍然必须与源逐字节相同：要改运行时变量，就换一个新的源文件，而不是就地改目标。
set -euo pipefail
SRC="$1"; TARGET="$2"; SHORT="$3"; ROLLBACK_NAME="$4"; POLL_N="${5:-48}"; POLL_S="${6:-5}"; MOUNT_SPEC="${7:-}"
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
docker inspect nianlife-diag-web --format "POST_IMAGE={{.Config.Image}} POST_STATUS={{.State.Status}} POST_HEALTH={{.State.Health.Status}} POST_STARTED={{.State.StartedAt}}"
docker inspect nianlife-diag-web --format '{{range .Config.Env}}{{println .}}{{end}}' | { grep -E '^(ORGANIZER_WORKER_ENABLED|MEMORY_ORGANIZER|AI_MODEL|NIANLIFE_BUILD_SHA|MONTH_CONTENT_DIR)=' || true; } | sort -u
docker inspect nianlife-diag-web --format 'POST_MOUNTS={{range .Mounts}}{{.Source}}->{{.Destination}}(rw={{.RW}}) {{end}}' 
echo "SWAP_OK"
