#!/usr/bin/env python3
"""Deploy collection and subscription schema; keep all secrets out of logs/argv."""
import argparse
import json
from pathlib import Path
import secrets
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def run(args, quiet=False):
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError("Supabase command failed" if quiet else result.stderr.strip())
    return result.stdout


def query(sql):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".sql") as file:
        file.write(sql)
        file.flush()
        result = json.loads(run(["supabase", "db", "query", "--linked", "--file", file.name, "-o", "json"], quiet=True))
        return result.get("rows", result) if isinstance(result, dict) else result


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-ref", required=True)
    args = parser.parse_args()
    if not args.project_ref.isalpha() or len(args.project_ref) != 20:
        parser.error("Invalid project ref")
    run(["supabase", "link", "--project-ref", args.project_ref])
    for name in ["2026-09-11-yonhap-notices.sql", "2026-09-11-yonhap-notice-subscriptions.sql", "2026-09-11-yonhap-notice-send-now.sql", "2026-09-11-page-access.sql"]:
        query((ROOT / "docs/sql" / name).read_text())
    print("Collection and subscription schema applied.")
    rows = query("select decrypted_secret as value from vault.decrypted_secrets where name = 'yonhap_sync_secret';")
    token = rows[0]["value"] if rows else secrets.token_hex(32)
    if not rows:
        query(f"select vault.create_secret({literal(token)}, 'yonhap_sync_secret');")
    project_url = f"https://{args.project_ref}.supabase.co"
    urls = query("select decrypted_secret as value from vault.decrypted_secrets where name = 'yonhap_project_url';")
    if urls and urls[0]["value"] != project_url:
        raise RuntimeError("Existing Yonhap URL points to a different project")
    if not urls:
        query(f"select vault.create_secret({literal(project_url)}, 'yonhap_project_url');")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".env") as file:
        file.write(f"YONHAP_SYNC_SECRET={token}\n")
        file.flush()
        run(["supabase", "secrets", "set", "--project-ref", args.project_ref, "--env-file", file.name], quiet=True)
    run(["supabase", "functions", "deploy", "yonhap-notices", "--project-ref", args.project_ref, "--use-api"])
    print("Collection function deployed.")
    query((ROOT / "docs/sql/2026-09-11-yonhap-notices-cron.sql").read_text())
    print("Daily collection scheduled for 07:00 Asia/Seoul.")
    print("Initial collection queued:", query("select public.invoke_yonhap_notices_sync() as request_id;"))


if __name__ == "__main__":
    main()
