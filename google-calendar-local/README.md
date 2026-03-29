# Google Calendar Local

Host-local OpenClaw skill that shells out to a Python CLI for Google Calendar.

## Layout

- `SKILL.md`: OpenClaw skill instructions.
- `bin/gcal`: thin wrapper that dispatches into the local virtualenv.
- `bin/gcal_cli.py`: JSON-only Google Calendar CLI.
- `scripts/install.sh`: creates `.venv` and installs Google client libraries.
- `scripts/test.sh`: runs unit tests, coverage, smoke tests, and optional live Calendar checks.
- `tests/test_gcal_cli.py`: deterministic unit coverage for the CLI module.

## Install

```bash
cd /path/to/skills-repo/google-calendar-local
./scripts/install.sh
```

## Use With OpenClaw

OpenClaw still needs the skill directory under one of its skill roots. This repo copy is the source of truth; symlink or copy it into the workspace when you want OpenClaw to load it.

```bash
mkdir -p ~/.openclaw/workspace/skills
ln -sfn /path/to/skills-repo/google-calendar-local ~/.openclaw/workspace/skills/google-calendar-local
```

If you prefer a plain copy instead of a symlink:

```bash
rm -rf ~/.openclaw/workspace/skills/google-calendar-local
cp -R /path/to/skills-repo/google-calendar-local ~/.openclaw/workspace/skills/google-calendar-local
```

## OAuth Bootstrap

1. Enable Google Calendar API in Google Cloud.
2. Configure the OAuth consent screen.
3. Create a Desktop OAuth client and download `credentials.json`.
4. Copy it to `~/.config/openclaw-google-calendar/credentials.json`.
5. If you are tunneling from a remote host, forward the loopback port:

```bash
ssh -L 8765:127.0.0.1:8765 youruser@your-ubuntu-box
```

6. Start the one-time auth flow:

```bash
./bin/gcal \
  auth init \
  --credentials ~/.config/openclaw-google-calendar/credentials.json \
  --token ~/.config/openclaw-google-calendar/token.json \
  --port 8765
```

The auth URL is printed to `stderr` so `stdout` stays reserved for the final JSON result. Tokens are refreshed automatically on later runs.

## Test

```bash
./scripts/test.sh
```

Set `ENABLE_GCAL_LIVE_READ_TESTS=1` to run authenticated read checks when a valid token is present.

Set `ENABLE_GCAL_LIVE_WRITE_TESTS=1` to also perform the create/get/update/delete round-trip against the configured calendar.
