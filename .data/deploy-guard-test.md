# 部署闸演练（2026-09-23）

脚本：`v2/scripts/deploy-ecs-public.sh`（闸 a = swap 前祖先检查；闸 b = 切换后真实页面冒烟，失败自动回滚）。

## 演练 1：重新部署线上版本 ce08236 —— 闸 a 放行、闸 b 通过

```
gate-a: live=ce082362d638b108ed55e2266e226ba2e803a0b2 deploy=ce082362d638b108ed55e2266e226ba2e803a0b2
GATE_A_OK live ce08236 is an ancestor of ce08236
=== SWAP === image nianlife-web:ce08236 env-file /home/ecs-user/.env.runtime.ce08236 rollback-container nianlife-diag-web-pre-ce08236-20260923-090044
nianlife-diag-web
MOUNT=/srv/nianlife-content:/srv/nianlife-content:ro
HEALTH_MOUNTS=/srv/nianlife-health:/srv/nianlife-health:ro /srv/nianlife-health/record:/srv/nianlife-health/record
4de3ac8f686b89f95cd19812777d49db0b2aab7ddd8066c039e69b9b6113ce4f
SINGLE_WRITER=nianlife-diag-web
POST_IMAGE=nianlife-web:ce08236 POST_STATUS=running POST_HEALTH=healthy POST_STARTED=2026-09-23T01:00:45.58430411Z
AI_MODEL=
MEMORY_ORGANIZER=rule
MONTH_CONTENT_DIR=/srv/nianlife-content
NIANLIFE_BUILD_SHA=ce082362d638b108ed55e2266e226ba2e803a0b2
ORGANIZER_WORKER_ENABLED=false
POST_MOUNTS=/srv/nianlife-content->/srv/nianlife-content(rw=false) /srv/nianlife-health->/srv/nianlife-health(rw=false) /srv/nianlife-health/record->/srv/nianlife-health/record(rw=true) 
SWAP_OK
ROLLBACK_CONTAINER=nianlife-diag-web-pre-ce08236-20260923-090044
RUN_DIR=/home/ecs-user/d04-runs/swap-ce08236-20260923-090044
smoke /api/health build.sha=ce08236 OK
smoke / 200 OK
smoke /health 200 OK
smoke /memory/2025/12 200 OK
smoke /memory/2025/12/01 200 OK
GATE_B_OK
{"keep": ["/nianlife-diag-web", "/nianlife-diag-web-pre-ce08236-20260923-082401", "/nianlife-diag-web-pre-36a36dd-20260923-062345"], "remove": ["/nianlife-diag-web-pre-ce08236-20260923-090044"]}
DEPRECATED: The legacy builder is deprecated and will be removed in a future release.
            Install the buildx component to build images with BuildKit:
            https://docs.docker.com/go/buildx/

{"before": {"total": 41882943488, "used": 10943893504, "available": 29003313152}, "after": {"total": 41882943488, "used": 10931392512, "available": 29015814144}, "removedContainers": 1, "removedImageTags": [], "releasedBytes": 12500992, "retainedImages": ["nianlife-web:ce08236", "nianlife-web:36a36dd", "nianlife-web:a3c4434"]}
EXIT=0
```

## 演练 2：用更旧的 a3c4434 —— 闸 a 拦下（未上传、未切换，线上仍是 ce08236）

```
gate-a: live=ce082362d638b108ed55e2266e226ba2e803a0b2 deploy=a3c4434dbfa27584a5b5452195f507cc7bd6b38a
STOP(gate-a): live ce08236 is NOT an ancestor of a3c4434; deploying would overwrite changes already online
EXIT=11
```

## 补充：冒烟函数反向测试（SITE 指向不存在的前缀，不做切换）

证明闸 b 在页面不对时判失败。自动回滚分支（rollback_app）未用真实坏版本演练过；它与原 rollback-app 子命令是同一段代码，另加了“回滚后必须 healthy”的检查。

```
smoke FAIL /api/health build.sha=none want ce08236
smoke FAIL / http=308 missing=[最近怎么样]
smoke FAIL /health http=404 missing=[年度累计生病][资料截至]
smoke FAIL /memory/2025/12 http=404 missing=[2025 年 12 月]
smoke FAIL /memory/2025/12/01 http=404 missing=[12 月 1 日]
SMOKE_RESULT=fail
```
