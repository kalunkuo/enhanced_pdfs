#!/usr/bin/env python3
"""Measure how well a coding agent reads an enhanced PDF without any help.

Each question runs headless Claude Code (`claude -p`) in a fresh, empty working
directory that contains only a copy of the PDF named `drawing.pdf`. The agent gets
no hints about attachments or tables; whatever it finds, it finds from the file.
Answers are scored on required substrings and the full transcripts are kept, so a
"before" and an "after" run of the same question set can be compared.

    python scripts/agent_eval.py enhanced.pdf --out output/agent-eval/before
    python scripts/agent_eval.py enhanced.pdf --out output/agent-eval/after --only q3,q4

Requires the `claude` CLI on PATH and a signed-in account. Standard library only.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_QUESTIONS = HERE / "agent_eval_questions.json"
PROMPT = (
    "The file drawing.pdf in the current directory is a PDF exported from Revit. "
    "Answer the question below using only that file. Use any tools you need to inspect it. "
    "Give the answer first, then say where in the file you found it. If the file does not "
    "contain the answer, say so.\n\nQuestion: {question}"
)


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def score(answer: str, question: dict) -> dict:
    text = normalize(answer)
    required = question.get("expect", [])
    hits = [token for token in required if normalize(token) in text]
    forbidden = [token for token in question.get("reject", []) if normalize(token) in text]
    used_tables = any(marker in text for marker in ("parquet", "attachment", "embedded file", "embeddedfiles"))
    return {
        "hits": hits,
        "misses": [token for token in required if token not in hits],
        "forbidden_hits": forbidden,
        "passed": len(hits) == len(required) and not forbidden,
        "mentions_attachments": used_tables,
    }


def run_question(pdf: Path, question: dict, model: str | None, max_turns: int, timeout: int) -> dict:
    with tempfile.TemporaryDirectory(prefix="epdf-agent-") as tmp:
        work = Path(tmp)
        shutil.copyfile(pdf, work / "drawing.pdf")
        cmd = [
            "claude", "-p", PROMPT.format(question=question["question"]),
            "--output-format", "json",
            "--max-turns", str(max_turns),
            "--dangerously-skip-permissions",
        ]
        if model:
            cmd += ["--model", model]
        env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")}
        started = time.time()
        try:
            proc = subprocess.run(cmd, cwd=work, env=env, capture_output=True, text=True,
                                  encoding="utf-8", errors="replace", timeout=timeout, shell=(os.name == "nt"))
            raw = proc.stdout
            try:
                result = json.loads(raw)
            except json.JSONDecodeError:
                result = {"result": raw, "is_error": True, "stderr": proc.stderr}
        except subprocess.TimeoutExpired as exc:
            result = {"result": (exc.stdout or b"").decode("utf-8", "replace") if isinstance(exc.stdout, bytes) else exc.stdout or "",
                      "is_error": True, "timeout": True}
        result["wall_seconds"] = round(time.time() - started, 1)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--out", type=Path, required=True, help="Directory for transcripts and summary")
    parser.add_argument("--questions", type=Path, default=DEFAULT_QUESTIONS)
    parser.add_argument("--only", help="Comma-separated question ids to run")
    parser.add_argument("--model", help="Model for the agent (default: the CLI's default)")
    parser.add_argument("--max-turns", type=int, default=25)
    parser.add_argument("--timeout", type=int, default=600, help="Seconds per question")
    parser.add_argument("--label", default="", help="Free text recorded in the summary (e.g. git commit)")
    args = parser.parse_args()

    questions = json.loads(args.questions.read_text(encoding="utf-8"))
    if args.only:
        wanted = set(args.only.split(","))
        questions = [q for q in questions if q["id"] in wanted]
    args.out.mkdir(parents=True, exist_ok=True)

    rows = []
    for question in questions:
        print(f"[{question['id']}] {question['question']}", flush=True)
        result = run_question(args.pdf, question, args.model, args.max_turns, args.timeout)
        answer = result.get("result") or ""
        verdict = score(answer, question)
        record = {"question": question, "score": verdict, "claude": result}
        (args.out / f"{question['id']}.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
        status = "PASS" if verdict["passed"] else "FAIL"
        print(f"    {status}  turns={result.get('num_turns')}  {result.get('wall_seconds')}s  "
              f"cost=${result.get('total_cost_usd', 0):.3f}  misses={verdict['misses']}", flush=True)
        rows.append((question["id"], status, result.get("num_turns"), result.get("wall_seconds"),
                     result.get("total_cost_usd", 0), verdict["mentions_attachments"], verdict["misses"], answer))

    passed = sum(1 for r in rows if r[1] == "PASS")
    lines = [f"# Agent eval: {args.pdf.name}", "", f"Label: {args.label}", f"Questions: {len(rows)}, passed: {passed}", "",
             "| id | result | turns | seconds | cost | found tables | missing |", "|---|---|---|---|---|---|---|"]
    for qid, status, turns, secs, cost, tables, misses, _ in rows:
        lines.append(f"| {qid} | {status} | {turns} | {secs} | {cost:.3f} | {'yes' if tables else 'no'} | {', '.join(misses)} |")
    lines += ["", "## Answers", ""]
    for qid, status, *_rest, answer in rows:
        lines += [f"### {qid} ({status})", "", answer.strip(), ""]
    (args.out / "summary.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"\n{passed}/{len(rows)} passed. Summary: {args.out / 'summary.md'}")
    return 0 if passed == len(rows) else 1


if __name__ == "__main__":
    sys.exit(main())
