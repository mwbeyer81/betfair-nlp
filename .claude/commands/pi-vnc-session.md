---
name: pi-vnc-session
description: Start a remote browsing session — ensure the TigerVNC server is running on this VM, then SSH into the Pi4 to launch startx. The Pi connects back via VNC and displays a terminal + Chromium browser side-by-side.
---

## Architecture

```
Pi4 (100.88.244.94)  ──startx──▶  openbox + lxterminal + vncviewer
                                          │
                                          ▼  VNC (port 5901)
Ubuntu VM (100.95.137.45)  ◀──────  TigerVNC :1  +  Chromium
```

The Pi screen shows: terminal on the left, full VM browser on the right.

## Step 1 — Launch startx on the Pi

The Pi's `~/.xinitrc` automatically SSHes into the VM and starts VNC if needed — no manual setup required.

```bash
ssh -i ~/.ssh/my-new-key mwbeyer@100.88.244.94 "startx"
```

Or if already SSH'd in: `startx`

`~/.xinitrc` will:
1. Start Openbox window manager
2. Open `lxterminal` (left side, 120×40)
3. SSH to VM and start `vncserver :1` if not already running
4. Connect `vncviewer` to `100.95.137.45:5901`

## Manual VNC control (if needed)

Start: `vncserver :1 -geometry 1920x1080 -depth 24 -rfbauth ~/.vnc/passwd -localhost no`

Stop: `vncserver -kill :1`

**Note:** `-localhost no` is required — without it VNC binds to 127.0.0.1 and the Pi can't connect over Tailscale.

## Step 3 — Use the session

- The Pi physical screen/keyboard/mouse controls both the terminal and browser
- Browse on the VM — fast network, not Pi4 hardware
- To reconnect VNC from a running X session (without restarting): `~/Desktop/connect-vm.sh`

## Notes

- Pi SSH key: `~/.ssh/my-new-key`
- Pi credentials: `mwbeyer` / `Mothership99`
- VNC password file on Pi: `~/.vnc/vm.passwd` (binary DES, password: `Mothership99`)
- Tailscale IPs are stable — Pi: `100.88.244.94`, VM: `100.95.137.45`
- If VNC viewer shows auth error, check VM VNC server is on `:1` (port 5901)
