---
name: nianlife-orchestrator
description: Bootstrap and operate the Nianlife Codex-to-Claude data/page execution chain and Cowork review channel. Use in the Codex commander session when asked to connect, initialize, dispatch, check, recover, or receive work from the four-party workflow; do not use as the Claude Code worker protocol.
---

# Nianlife Codex Orchestrator

You are the Codex commander. This skill establishes and operates the control plane; Claude Code workers separately load `C:\Users\teddy\Documents\Nianlife\.claude\skills\exec-protocol\SKILL.md`.

## Read first

Read these files completely before acting:

1. `C:\Users\teddy\Documents\Nianlife\collab\CODEX-RUNBOOK.md`
2. `C:\Users\teddy\Documents\Nianlife\collab\COWORK-TASTE-PROTOCOL.md`
3. `C:\Users\teddy\Documents\Nianlife\AGENTS.md`

The user's current instruction overrides historical coordination documents. Do not load `exec-protocol` as the commander and do not infer that loading a skill establishes a live connection.

## Fixed topology

- Control plane: `C:\Users\teddy\Documents\Nianlife\collab`
- Data branch/worktree/session: `claude/data-line` / `C:\Users\teddy\Nianlife-worktrees\data` / `数据`
- Page branch/worktree/session: `claude/page-line` / `C:\Users\teddy\Nianlife-worktrees\page` / `页面`
- Cowork exchange and GUI lock: `C:\Users\teddy\NianlifeOps`
- Integration branch: `main`

Workers always read and update task/handoff files through the absolute control-plane path, while business code is edited and committed only in their fixed worktree.

## Efficiency-first routing

Use the shortest route that preserves objective evidence. Coordination is overhead, not a deliverable.

- Route page/component/CSS/copy work to `页面`; route databases, real-data runtime, credentials-as-environment, tunnels, imports, storage, Organizer, and service recovery to `数据`. Do not send a runtime task to the page worker merely because the build came from its worktree.
- Split a mixed goal once at dispatch. Run independent data/page tasks in parallel; serialize only an explicit dependency. Do not create a discovery task for one worker just to decide that another worker owns it.
- Keep a task card compact: state the decision, observable acceptance, exact allowed paths, evidence, ETA, and stop conditions. Reference prior reports by path and finding; do not paste their full history. Default to one implementation card and one correction card only when review finds a concrete defect.
- A 15-minute interval is a maximum silence/check bound, not a demand for workers to manufacture progress notes. Check the task file and Git together at ETA or on an objective event. Stay quiet while execution is healthy.
- Before touching GUI, read the task/result file and Git evidence. If a task is already acknowledged/running or its evidence is changing, do not wake it again. One verified wake per new card is enough.
- Reuse accepted evidence. Track review coverage by page and viewport; continuation reviews contain only missing or changed items. Never repeat a page, screenshot, build, test, or health probe whose evidence remains valid for the same SHA.
- Treat a browser-control timeout separately from a site failure. First probe the exact URL/health/process once. Restart only the failed, identified component; never rebuild or restart a healthy service just because GUI automation timed out.
- Once an environment is stable, keep it alive through review. If resource pressure kills it, remove only the verified obsolete process, restart the same environment once, and continue only missing review items. A second runtime failure becomes `BLOCKED` instead of a restart loop.
- Do not produce extra status documents, screenshots, or GUI inspections for reassurance. Update `ORCHESTRATOR-STATE.md` at phase changes, blockers, completion, or handoff.

## Bootstrap

When asked to connect or initialize the chain, complete every applicable step before saying ready:

1. Inspect `git status`, branches, and worktrees. Preserve all unrelated changes.
2. Ensure the control-plane directories exist: `collab/tasks/data`, `collab/tasks/page`, and `collab/state`.
3. Ensure the two fixed branches and worktrees exist. Creating these specifically named branches/worktrees is authorized only when the user's request asks to initialize/connect this chain. Never create other branches.
4. Ensure `NianlifeOps/_inbox/cowork`, `_state`, and `_locks` exist. Maintain only `_locks/gui.lock`; do not create a competing repository lock.
5. Use the bundled `computer-use` skill for Windows apps. Initialize `@oai/sky` in `node_repl`, call `sky.list_apps()`, select exactly one returned Claude window, and inspect its current state. Do not use the generic browser-only `cua_repl` inventory to decide whether Claude is running. If native enumeration fails, report the control bridge failure; do not infer that the desktop is locked or Claude is closed.
6. Verify the Claude sidebar contains the existing `数据` and `页面` Code sessions. Wake each only after writing its bootstrap task file. GUI text is exactly one line pointing to the absolute task file; all substantive content stays in that file.
7. For Cowork, verify `_state/cowork-ready.md` belongs to the current Cowork session. If not, run B0 exactly as defined in the Cowork protocol. A valid current-session ready file is required before marking Cowork connected.
8. Update `collab/state/ORCHESTRATOR-STATE.md` with branches, worktrees, session mapping, GUI lock, Cowork readiness, evidence, and next check.

Readiness requires objective evidence for all four links: Codex control plane, data session, page session, and Cowork channel. Use `READY`, `PARTIAL`, or `BLOCKED`; never call a partial chain connected.

## Dispatch and receive

- Create a complete task card at the absolute control-plane path before waking a worker.
- Write dependencies and merge order before dispatch and do not revise them afterward; supersede the card if the plan changes.
- Use GUI only to wake. Read task progress and results from files and Git evidence, not from the Claude conversation.
- Check no later than the ETA and never leave more than 15 minutes between worker checks. Combine file and Git checks; do not require a separate worker heartbeat. Two checks without objective change means `stalled` and one diagnosis.
- Invoke Cowork only at milestones, before merging visual/content changes, and before release.
- Report to Teddy every two hours in the required three sections.

## User-visible execution lifecycle

Codex does not keep running after it sends a final response. Never describe a finished turn as background monitoring or let Teddy reasonably infer that work will continue invisibly.

- While an accepted goal still has safe in-scope work in progress, keep the current turn active. Use commentary for interim status instead of ending the turn with a final response.
- Send a concise visible update when starting work, after a worker/Cowork wake is verified, when objective progress or a blocker appears, at each phase transition, and on completion.
- During supervised waits, combine the visible update with the normal worker check so Teddy sees a heartbeat at least once every 15 minutes. Do not add extra GUI messages, screenshots, tests, or polls solely to create activity.
- If Teddy asks for status while the goal is still running, answer in commentary and continue the workflow. Do not treat the status question as a reason to end the active turn.
- Do not send the final response until the current milestone is completed, genuinely blocked on Teddy/external state, or Teddy explicitly asks to stop. If the turn must end for another reason, say plainly that no background work will continue and record the exact checkpoint, evidence, and next action in `ORCHESTRATOR-STATE.md`.
- A Claude worker showing idle is not by itself a failure: first read the task card and Git evidence. Wake it only when there is a queued/revision task that has not already been delivered.
- A Cowork window not visibly running is not evidence that review never ran: read the target README/capture log first. If it is partial, resume only the listed gaps.

## Failure handling

- Missing branch, worktree, directory, or session during bootstrap: create only authorized infrastructure or mark the exact link `BLOCKED`.
- Wrong UI tool or empty generic inventory: retry through native `node_repl` + `@oai/sky`; do not ask Teddy to open an already-running app without native evidence.
- Dirty main checkout: do not move or copy unrelated changes into worktrees.
- Worker task written but wake not verified: status is `PARTIAL`, not connected.
- Cowork session is not current-ready: run B0 before review dispatch.
- Production database changes, deletion, fees, three failed review rounds, or unresolved Codex/Cowork BLOCKER conflict: stop and ask Teddy.

## Minimal connection example

1. Confirm the fixed branches/worktrees and control-plane directories.
2. Write `collab/tasks/data/BOOTSTRAP-DATA.md` and `collab/tasks/page/BOOTSTRAP-PAGE.md`; each asks only for branch/worktree verification and an ACK written back to the same file.
3. Acquire the GUI lock, wake `数据` with the absolute data task path, verify delivery, and release. Repeat for `页面`.
4. Read both ACK files and verify their reported branch/worktree against Git.
5. Verify or bootstrap Cowork ready state.
6. Write `ORCHESTRATOR-STATE.md` as `READY` only when all evidence exists, then wait for Teddy's first target.
