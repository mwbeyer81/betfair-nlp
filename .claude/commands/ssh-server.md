# SSH Server

Connect to the production server at ubuntu@backbet.co.uk and run commands in the betfair-nlp directory.

## How to run remote commands

Use this pattern for any remote command:

```bash
ssh -i ~/.ssh/BackBet.pem ubuntu@backbet.co.uk "cd betfair-nlp && <command>"
```

## Common tasks

**Check server status / git state:**
```bash
ssh -i ~/.ssh/BackBet.pem ubuntu@backbet.co.uk "cd betfair-nlp && git status --short"
```

**View running processes:**
```bash
ssh -i ~/.ssh/BackBet.pem ubuntu@backbet.co.uk "pgrep -a node"
```

**Tail server logs:**
```bash
ssh -i ~/.ssh/BackBet.pem ubuntu@backbet.co.uk "cd betfair-nlp && tail -50 logs/server.log 2>/dev/null || journalctl -u betfair-nlp -n 50 --no-pager 2>/dev/null"
```

**Pull latest and restart:**
```bash
ssh -i ~/.ssh/BackBet.pem ubuntu@backbet.co.uk "cd betfair-nlp && git pull && npm run deploy"
```

## Notes

- Key: `~/.ssh/BackBet.pem` (read-only, already correct permissions)
- Remote path: `/home/ubuntu/betfair-nlp`
- Always quote the remote command in double quotes and chain with `&&` after `cd betfair-nlp`
