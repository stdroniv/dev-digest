#!/usr/bin/env python3
"""Deep-mode metrics for a multi-agent run — read-only, stdlib-only.

Parses the on-disk sub-agent JSONL journals for a session and aggregates exact
token/tool/timing metrics per agent, then a grand total. Use this only when the
in-context `<usage>` blocks are not enough (nested agents, exact cache figures).

Journals live flat under the session directory, so a single glob catches every
agent at every depth:

    ~/.claude/projects/<project-slug>/<session-id>/subagents/agent-*.jsonl

Each journal has a sibling `<journal>.meta.json` carrying `agentType`,
`description`, and `spawnDepth` (1 = top-level, >1 = nested). Nested agents are
the reason the in-context view undercounts: a parent's `<usage>` block reports
only the parent's own tokens, not its children's. One observed run looked like
"1 agent / ~75k" but was really 5 agents (a spec-creator plus 4 nested
researchers) at a far higher true total — so whenever the run used an agent that
can spawn sub-agents, or you are unsure, prefer this deep parse.

Cost is deliberately NOT hard-coded. Pass `--prices prices.json` (substring-keyed
per-model rates) to compute $; otherwise cost is reported as n/a. Confirm current
per-model rates via the `claude-api` skill before trusting any dollar figure —
prices go stale.

Usage:
    python3 analyze_journals.py FILE_OR_GLOB [FILE_OR_GLOB ...] [--json] [--prices prices.json]
"""

import argparse
import glob
import json
import os
import sys
from datetime import datetime


def parse_ts(value):
    """Parse an ISO-8601 timestamp (tolerating a trailing 'Z') → datetime or None."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def agent_label(path):
    """Human label from a journal path: strips the `agent-` prefix and `.jsonl`."""
    base = os.path.basename(path)
    if base.endswith(".jsonl"):
        base = base[: -len(".jsonl")]
    if base.startswith("agent-"):
        base = base[len("agent-"):]
    return base


def load_meta(path):
    """Read the sibling `<journal>.meta.json` for agentType/description/spawnDepth.

    spawnDepth defaults to 1 (top-level) when absent — see the module docstring
    for why depth matters (nested agents are what the in-context view misses).
    """
    meta_path = path + ".meta.json"
    meta = {"agentType": None, "description": None, "spawnDepth": 1}
    try:
        with open(meta_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        meta["agentType"] = data.get("agentType")
        meta["description"] = data.get("description")
        meta["spawnDepth"] = int(data.get("spawnDepth", 1) or 1)
    except (OSError, ValueError, TypeError):
        pass
    return meta


def accumulate(path):
    """Stream one JSONL journal line-by-line, summing usage/tools/timing.

    Streaming (rather than json.load of the whole file) keeps memory flat on the
    large journals a long agent produces.
    """
    totals = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0,
        "tool_calls": 0,
    }
    models = set()
    ts_first = None
    ts_last = None

    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue

                ts = parse_ts(rec.get("timestamp") or rec.get("ts"))
                if ts is not None:
                    if ts_first is None or ts < ts_first:
                        ts_first = ts
                    if ts_last is None or ts > ts_last:
                        ts_last = ts

                message = rec.get("message") or {}
                if isinstance(message, dict):
                    if message.get("model"):
                        models.add(message["model"])
                    usage = message.get("usage") or {}
                    for key in (
                        "input_tokens",
                        "output_tokens",
                        "cache_read_input_tokens",
                        "cache_creation_input_tokens",
                    ):
                        totals[key] += int(usage.get(key, 0) or 0)

                    content = message.get("content")
                    if isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict) and block.get("type") == "tool_use":
                                totals["tool_calls"] += 1
    except OSError as exc:
        print(f"warning: could not read {path}: {exc}", file=sys.stderr)

    totals["models"] = sorted(models)
    totals["ts_first"] = ts_first
    totals["ts_last"] = ts_last
    return totals


def price_for(model, prices):
    """Substring-match a model id to a rate entry in the --prices map."""
    if not prices or not model:
        return None
    for key, rates in prices.items():
        if key in model:
            return rates
    return None


def cost_of(agent, prices):
    """Per-agent $ cost, or None if no matching price entry was supplied."""
    if not prices:
        return None
    model = agent["models"][0] if agent["models"] else None
    rates = price_for(model, prices)
    if not rates:
        return None
    # Rates are $ per 1M tokens for each token class.
    def rate(name):
        return float(rates.get(name, 0) or 0)

    return (
        agent["input_tokens"] * rate("in")
        + agent["output_tokens"] * rate("out")
        + agent["cache_read_input_tokens"] * rate("cache_read")
        + agent["cache_creation_input_tokens"] * rate("cache_write")
    ) / 1_000_000.0


def span_seconds(agent):
    first, last = agent.get("ts_first"), agent.get("ts_last")
    if first is None or last is None:
        return None
    return (last - first).total_seconds()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Aggregate multi-agent run journals.")
    parser.add_argument("paths", nargs="+", help="journal file(s) or glob(s)")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    parser.add_argument("--prices", help="path to a substring-keyed price map JSON")
    args = parser.parse_args(argv)

    prices = None
    if args.prices:
        try:
            with open(args.prices, "r", encoding="utf-8") as fh:
                prices = json.load(fh)
        except (OSError, ValueError) as exc:
            print(f"error: could not read --prices {args.prices}: {exc}", file=sys.stderr)
            return 2

    files = []
    for pattern in args.paths:
        files.extend(sorted(glob.glob(os.path.expanduser(pattern))))
    files = sorted(set(files))
    if not files:
        print("error: no journal files matched", file=sys.stderr)
        return 1

    agents = []
    for path in files:
        totals = accumulate(path)
        meta = load_meta(path)
        totals.update(
            label=agent_label(path),
            path=path,
            agentType=meta["agentType"],
            description=meta["description"],
            spawnDepth=meta["spawnDepth"],
        )
        agents.append(totals)

    # Launch order == first-seen timestamp.
    agents.sort(key=lambda a: (a["ts_first"] or datetime.max))

    grand = {k: 0 for k in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "tool_calls")}
    spans = []
    ts_first_all = None
    ts_last_all = None
    for a in agents:
        for k in grand:
            grand[k] += a[k]
        s = span_seconds(a)
        if s is not None:
            spans.append(s)
        if a["ts_first"] and (ts_first_all is None or a["ts_first"] < ts_first_all):
            ts_first_all = a["ts_first"]
        if a["ts_last"] and (ts_last_all is None or a["ts_last"] > ts_last_all):
            ts_last_all = a["ts_last"]
        a["cost"] = cost_of(a, prices)
        a["span_seconds"] = s

    wall = (ts_last_all - ts_first_all).total_seconds() if (ts_first_all and ts_last_all) else None
    sum_span = sum(spans) if spans else 0.0
    parallelism = (sum_span / wall) if (wall and wall > 0) else None

    input_side = grand["input_tokens"] + grand["cache_read_input_tokens"] + grand["cache_creation_input_tokens"]
    cache_hit = (grand["cache_read_input_tokens"] / input_side) if input_side else None

    nested_agents = sum(1 for a in agents if a["spawnDepth"] > 1)
    max_depth = max((a["spawnDepth"] for a in agents), default=1)

    grand_cost = None
    if prices:
        costs = [a["cost"] for a in agents if a["cost"] is not None]
        grand_cost = sum(costs) if costs else None

    summary = {
        "agent_count": len(agents),
        "nested_agents": nested_agents,
        "max_depth": max_depth,
        "totals": grand,
        "wall_seconds": wall,
        "sum_agent_span_seconds": sum_span,
        "parallelism": parallelism,
        "cache_hit": cache_hit,
        "cost": grand_cost,
        "agents": [
            {
                "label": a["label"],
                "agentType": a["agentType"],
                "spawnDepth": a["spawnDepth"],
                "input_tokens": a["input_tokens"],
                "output_tokens": a["output_tokens"],
                "cache_read_input_tokens": a["cache_read_input_tokens"],
                "cache_creation_input_tokens": a["cache_creation_input_tokens"],
                "tool_calls": a["tool_calls"],
                "span_seconds": a["span_seconds"],
                "models": a["models"],
                "cost": a["cost"],
            }
            for a in agents
        ],
    }

    if args.json:
        # datetimes are already stripped from the emitted structure above.
        print(json.dumps(summary, indent=2))
        return 0

    # Human-readable indented table; nested agents (depth>1) are prefixed with └.
    def fmt(n):
        return f"{n:,}"

    def fmt_cost(c):
        return "n/a" if c is None else f"${c:,.2f}"

    print(f"agents: {summary['agent_count']}  (nested: {nested_agents}, max depth: {max_depth})")
    print(f"{'agent':<28} {'in':>10} {'out':>10} {'cache_read':>12} {'tools':>6} {'span(s)':>8} {'cost':>8}")
    for a in agents:
        prefix = ("  " * (a["spawnDepth"] - 1)) + ("└ " if a["spawnDepth"] > 1 else "")
        label = (prefix + (a["agentType"] or a["label"]))[:28]
        span = "n/a" if a["span_seconds"] is None else f"{a['span_seconds']:.1f}"
        print(
            f"{label:<28} {fmt(a['input_tokens']):>10} {fmt(a['output_tokens']):>10} "
            f"{fmt(a['cache_read_input_tokens']):>12} {a['tool_calls']:>6} {span:>8} {fmt_cost(a['cost']):>8}"
        )
    print("-" * 86)
    print(
        f"{'TOTAL':<28} {fmt(grand['input_tokens']):>10} {fmt(grand['output_tokens']):>10} "
        f"{fmt(grand['cache_read_input_tokens']):>12} {grand['tool_calls']:>6} "
        f"{(f'{wall:.1f}' if wall is not None else 'n/a'):>8} {fmt_cost(grand_cost):>8}"
    )
    if cache_hit is not None:
        print(f"cache hit: {cache_hit*100:.0f}%   parallelism: {parallelism:.2f}x" if parallelism else f"cache hit: {cache_hit*100:.0f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
