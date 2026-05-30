# Commit changes

Stage and commit all current changes with a generated commit message.

## Steps

1. Run `git status` to see what has changed (never use `-uall`).
2. Run `git diff HEAD` to understand the full diff.
3. Check recent commits with `git log --oneline -5` to match the repo's commit style.
4. Draft a concise commit message (imperative mood, 1–2 sentences, focus on WHY not WHAT).
5. **Show the user the proposed message and ask for confirmation before committing.**
6. Once confirmed, stage relevant files and commit:
   ```
   git add <files>
   git commit -m "$(cat <<'EOF'
   <message>

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```
7. Run `git status` to confirm the commit succeeded.

## Rules

- Never commit secrets, `.env` files, or large binaries.
- Never force-push or amend published commits.
- Never skip hooks (`--no-verify`).
- If the user says "yes" or "go ahead", proceed immediately without re-asking.
- If the user wants to edit the message, incorporate their changes before committing.
