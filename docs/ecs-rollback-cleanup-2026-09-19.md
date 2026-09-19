# ECS rollback cleanup — 2026-09-19

User authorized inspection of current ECS storage and cleanup of old rollback resources.

## Result

- System disk: 41882943488 bytes (39.01 GiB).
- Before deletion: used 37536522240 bytes; available 2410684416 bytes (2.25 GiB).
- After deletion and a second disk check: used 37231308800 bytes (34.67 GiB); available 2715897856 bytes (2.53 GiB).
- Actual available-space increase: 305213440 bytes (291.07 MiB).
- Removed 37 stopped historical rollback containers and 34 old nianlife-web image tags.
- Four containers remain: current application, two stopped rollback versions, and Caddy.
- Available space remains limited. Removing image tags does not imply the sum of displayed image sizes was reclaimed. Docker reports 203 images including intermediate images; its negative reclaimable-size output was not used as a reliable estimate.

## Retained release and rollback points

- Current: nianlife-diag-web, image nianlife-web:f9e5163.
- Latest rollback: nianlife-diag-web-pre-f9e5163-20260919-120108, image nianlife-web:7a5c14b.
- Second rollback: nianlife-diag-web-pre-7a5c14b-20260919-094413, image nianlife-web:9cae65e.
- Historical references to older stopped rollback containers are superseded by this cleanup.

## Safety and verification

All candidates were revalidated against exact container IDs, names, image IDs and exited state before deletion. Writable changes were restricted to Next.js runtime output/cache and directory mount placeholders. Containers were removed without force or volume deletion. Image tags were removed without force only after verifying their IDs and absence of remaining container references.

Content bind mounts, environment files, Docker volumes, Caddy, builder/base images and unrelated build artifacts were preserved. No application source or monthly-report content was changed.

After cleanup, the same current container remained healthy; HTTPS homepage returned 200, redirects remained valid, and /api/health returned ok=true, db=connected, build SHA f9e51636b2ed1707b9e2bd3a31b4621ea650eff3. The two rollback containers and their image IDs were verified retained; rollback execution was not performed.