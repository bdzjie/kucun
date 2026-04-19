# Sandbox Config

管理 OpenClaw 安全沙箱配置。

Inspired by Claude Code's `settings-strict.json` sandbox model.

## Usage

```
/sandbox-config --status
/sandbox-config --report
/sandbox-config --enable
/sandbox-config --disable
/sandbox-config --set <key> <value>
/sandbox-config --add-domain <domain>
/sandbox-config --remove-domain <domain>
/sandbox-config --block-docker
/sandbox-config --allow-docker
/sandbox-config --block-reverse-shells
/sandbox-config --validate
```

## Commands

- `--status` — Show sandbox status (enabled/disabled)
- `--report` — Full sandbox security report
- `--enable` — Enable sandbox enforcement
- `--disable` — Disable sandbox (not recommended)
- `--set <key> <value>` — Set a configuration value
- `--add-domain <domain>` — Add domain to whitelist (*.example.com)
- `--remove-domain <domain>` — Remove domain from whitelist
- `--block-docker` — Block Docker operations
- `--allow-docker` — Allow Docker operations
- `--block-reverse-shells` — Block reverse shell patterns
- `--validate` — Validate configuration consistency

## Security Features

| Feature | Default | Description |
|---------|---------|-------------|
| enabled | true | Master switch |
| blockDocker | true | Block Docker commands |
| blockReverseShells | true | Block common reverse shell patterns |
| allowExternalNetwork | true | Allow outbound network |
| allowLocalBinding | true | Allow localhost port binding |
| allowUnixSockets | false | Disable Unix sockets by default |
| allowedDomains | localhost | Domain whitelist |
| deniedDomains | *.onion, tunnels | Block suspicious domains |
| deniedPaths | /etc/shadow, /root/.ssh | Protected paths |

## Examples

```
/sandbox-config --status
/sandbox-config --report
/sandbox-config --add-domain *.github.com
/sandbox-config --block-reverse-shells
/sandbox-config --set maxFileSize 104857600
```

## Technical Details

**Module**: `modules/security_sandbox.mjs`

Config file: `~/.openclaw/config/sandbox.json`
