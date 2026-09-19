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
## Follow-up: unused build images and cache removed

The user explicitly authorized this additional cleanup on 2026-09-19.

- Revalidated the exact current and two rollback container IDs, image IDs and content mounts before and after cleanup; all were retained.
- Ran Docker dangling-image cleanup and unused builder-cache cleanup. No containers, volumes, runtime configuration, content or deployment directories were deleted in this step.
- Before: used 37,233,385,472 bytes; available 2,713,821,184 bytes (2.53 GiB).
- Immediately after: used 8,806,821,888 bytes; available 31,140,384,768 bytes (29.00 GiB).
- Actual filesystem space released: 28,426,563,584 bytes (26.48 GiB). Docker's own reported 6.65 GB is a different accounting figure; filesystem measurements determine this report.
- Final repeated check: total 41,882,943,488 bytes (39.01 GiB), used 8,806,830,080 bytes (8.20 GiB), available 31,140,376,576 bytes (29.00 GiB), df utilization 23%. Filesystem reserved space accounts for total minus used being larger than available.
- No dangling images remained in the image listing. Seven tagged images remain, including the three protected releases, one other tagged historical image, builder/base images and Caddy.
- Post-cleanup HTTPS homepage returned 200; health API reported ok=true, db=connected and unchanged live SHA f9e51636b2ed1707b9e2bd3a31b4621ea650eff3. Current application remained healthy and Caddy remained running.
- Future builds may regenerate removed dependency/build layers. No automatic cleanup policy was installed.
