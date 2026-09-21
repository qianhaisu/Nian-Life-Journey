#!/usr/bin/env python3
"""Keep the live release and two latest rollback containers. Default: dry run.

Caller must hold /home/ecs-user/.nianlife-deploy.lock across build/swap/cleanup.
"""
import argparse
import json
import os
import re
import subprocess
import urllib.request

ROLLBACK = re.compile(r"nianlife-diag-web-pre-[0-9a-f]+-(\d{8}-\d{6})")
APP_IMAGE = re.compile(r"nianlife-web:([0-9a-f]{7,40})")


def run(*args):
    return subprocess.check_output(args, text=True)


def containers():
    ids = run("docker", "ps", "-aq").split()
    return json.loads(run("docker", "inspect", *ids)) if ids else []


def plan(items):
    live = next(c for c in items if c["Name"] == "/nianlife-diag-web")
    if live["State"]["Status"] != "running" or live["State"].get("Health", {}).get("Status") != "healthy":
        raise RuntimeError("Current release is not healthy")
    if not APP_IMAGE.fullmatch(live["Config"]["Image"]):
        raise RuntimeError("Unexpected current image")
    candidates = [c for c in items if ROLLBACK.fullmatch(c["Name"].lstrip("/"))]
    for c in candidates:
        if c["State"]["Status"] != "exited" or not APP_IMAGE.fullmatch(c["Config"]["Image"]):
            raise RuntimeError("Unexpected rollback state/image: " + c["Name"])
    candidates.sort(key=lambda c: ROLLBACK.fullmatch(c["Name"].lstrip("/")).group(1), reverse=True)
    keep, remove = [live], []
    seen = {live["Image"]}
    for c in candidates:
        if c["Image"] not in seen and len(keep) < 3:
            keep.append(c)
            seen.add(c["Image"])
        else:
            remove.append(c)
    return keep, remove


def identity(c):
    # docker inspect does not promise the order of Mounts (several bind mounts: it varies between calls), so compare them as a set
    return (c["Id"], c["Image"], sorted(json.dumps(m, sort_keys=True) for m in c.get("Mounts", [])))


def check_http(live):
    with urllib.request.urlopen("http://127.0.0.1:3000/api/health", timeout=20) as r:
        health = json.load(r)
    tag = APP_IMAGE.fullmatch(live["Config"]["Image"]).group(1)
    if not health.get("ok") or not health.get("build", {}).get("sha", "").startswith(tag):
        raise RuntimeError("Live health/release mismatch")
    with urllib.request.urlopen("http://127.0.0.1:3000/", timeout=20) as r:
        if r.status != 200:
            raise RuntimeError("Homepage failed")


def disk():
    s = os.statvfs("/")
    return dict(total=s.f_blocks*s.f_frsize, used=(s.f_blocks-s.f_bfree)*s.f_frsize,
                available=s.f_bavail*s.f_frsize)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    keep, remove = plan(containers())
    print(json.dumps({"keep": [c["Name"] for c in keep], "remove": [c["Name"] for c in remove]}), flush=True)
    if not args.apply:
        return
    check_http(keep[0])
    before = disk()
    for c in remove:
        fresh = json.loads(run("docker", "inspect", c["Id"]))[0]
        if identity(fresh) != identity(c) or fresh["Name"] != c["Name"] or fresh["State"]["Status"] != "exited":
            raise RuntimeError("Rollback changed during cleanup")
        run("docker", "rm", c["Id"])
    referenced = {c["Image"] for c in containers()}
    tags = run("docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}").splitlines()
    removed_tags = []
    for tag in tags:
        if APP_IMAGE.fullmatch(tag):
            img = json.loads(run("docker", "image", "inspect", tag))[0]
            if img["Id"] not in referenced:
                run("docker", "image", "rm", tag)
                removed_tags.append(tag)
    run("docker", "image", "prune", "--force")
    run("docker", "builder", "prune", "--force")
    after = disk()
    current = {c["Id"]: c for c in containers()}
    for c in keep:
        if c["Id"] not in current or identity(current[c["Id"]]) != identity(c):
            raise RuntimeError("Protected container changed")
    final_keep, final_remove = plan(list(current.values()))
    if final_remove:
        raise RuntimeError("Rollback retention limit not met")
    check_http(final_keep[0])
    print(json.dumps({"before": before, "after": after,
                      "removedContainers": len(remove), "removedImageTags": removed_tags,
                      "releasedBytes": after["available"]-before["available"],
                      "retainedImages": [c["Config"]["Image"] for c in final_keep]}), flush=True)


if __name__ == "__main__":
    main()
