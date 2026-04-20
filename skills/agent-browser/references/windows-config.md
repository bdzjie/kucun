# Windows Configuration

## Chrome Path

If Chrome isn't found automatically, create `~/.agent-browser/config.toml`:

```toml
executable_path = "C:\\Users\\Administrator\\.agent-browser\\browsers\\chrome-147.0.7727.57\\chrome-win64\\chrome.exe"
```

Or use the `--executable-path` flag:

```bash
agent-browser --executable-path "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" open https://www.bing.com
```

## Auto-Connect to Running Chrome

```bash
agent-browser --auto-connect open https://www.bing.com
```

## Chrome Already Installed

Chrome 147.0.7727.57 is pre-installed at:
```
~/.agent-browser/browsers/chrome-147.0.7727.57/chrome-win64/chrome.exe
```

## Troubleshooting

```bash
# Check install status
agent-browser install --status

# Force reinstall
agent-browser install

# Close stuck browser
agent-browser close --all

# View console errors
agent-browser console

# Get CDP URL
agent-browser get cdp-url
```
