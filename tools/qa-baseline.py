#!/usr/bin/env python3
"""Reproducible QA profiler. Linux /proc; QA commands may regenerate artifacts."""
from __future__ import annotations
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
STAGES = (
    ("core", ["npm", "run", "qa:core"]),
    ("optimizer", ["npm", "run", "qa:optimizer"]),
    ("durability", ["npm", "run", "qa:browser:durability"]),
    ("browser", ["npm", "run", "qa:browser"]),
)

def snapshot(root: int):
    """Sample process tree: aggregate RSS includes shared pages (not unique RAM)."""
    processes = {}
    for entry in os.scandir("/proc"):
        if not entry.name.isdecimal():
            continue
        try:
            pid = int(entry.name)
            parts = (Path(entry.path) / "stat").read_text().rsplit(") ", 1)[1].split()
            ppid = int(parts[1])
            rss_pages = int(parts[21])
            argv = (Path(entry.path) / "cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")
            processes[pid] = (ppid, rss_pages * os.sysconf("SC_PAGE_SIZE") // 1024, argv)
        except (OSError, ValueError, IndexError):
            continue
    descendants = {root}
    while True:
        newly = {pid for pid, (ppid, _, _) in processes.items() if ppid in descendants}
        if newly <= descendants:
            break
        descendants |= newly
    alive = {pid: processes[pid] for pid in descendants if pid in processes}
    browsers = {
        pid for pid, (_, _, cmd) in alive.items()
        if "chromium" in cmd and "--remote-debugging-pipe" in cmd and "--type=" not in cmd
    }
    return alive, browsers

def measure(name: str, command: list[str]):
    log_path = Path("/tmp") / ("qa-pass-a-" + name + ".log")
    seen_pids: set[int] = set()
    seen_browsers: set[int] = set()
    peak_sum_rss_kib = 0
    peak_process_rss_kib = 0
    peak_processes = 0
    samples = 0
    begin = time.monotonic()
    with log_path.open("wb") as stream:
        p = subprocess.Popen(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT)
        while True:
            alive, browsers = snapshot(p.pid)
            seen_pids.update(alive)
            seen_browsers.update(browsers)
            rss = [data[1] for data in alive.values()]
            peak_sum_rss_kib = max(peak_sum_rss_kib, sum(rss))
            peak_process_rss_kib = max(peak_process_rss_kib, max(rss, default=0))
            peak_processes = max(peak_processes, len(alive))
            samples += 1
            if p.poll() is not None:
                break
            time.sleep(0.05)
        status = p.wait()
    elapsed = round(time.monotonic() - begin, 3)
    log = log_path.read_text(errors="replace")
    rows = log.splitlines()
    result = {
        "stage": name,
        "command": " ".join(command),
        "exit_code": status,
        "wall_seconds": elapsed,
        "peak_summed_rss_mib": round(peak_sum_rss_kib / 1024, 2),
        "peak_single_process_rss_mib": round(peak_process_rss_kib / 1024, 2),
        "peak_concurrent_processes": peak_processes,
        "sampled_unique_pids_lower_bound": len(seen_pids),
        "sampled_chromium_browser_launches_lower_bound": len(seen_browsers),
        "explicit_qa_subcommands": sum("==> " in row for row in rows),
        "samples": samples,
        "log_file": str(log_path),
        "pass_tail": [row[:180] for row in rows if "PASS " in row][-6:],
    }
    print("QA_PASS_A_RESULT " + json.dumps(result, sort_keys=True), flush=True)
    if status:
        print("\n".join(rows[-45:]), flush=True)
        raise SystemExit(status)
    return result

def main():
    results = []
    for name, command in STAGES:
        results.append(measure(name, command))
    print("QA_PASS_A_SUMMARY " + json.dumps(results, sort_keys=True), flush=True)

if __name__ == "__main__":
    main()
