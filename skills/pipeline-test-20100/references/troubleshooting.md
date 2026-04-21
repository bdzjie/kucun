# pipeline-test-20100 — Troubleshooting

## Common Issues

### Command not recognized
- Check that you're using the correct command name
- Run `/pipeline-test-20100 help` to see available commands

### No output returned
- Ensure the skill has necessary permissions
- Check the handler.js for errors in browser console

### State not persisting
- State is in-memory only and resets between invocations
- For persistent state, use memory files or a database

## Debug Mode

Add `--debug` flag to any command:
```
/pipeline-test-20100 <command> --debug
```

## Getting Help

Run without arguments or with `help`:
```
/pipeline-test-20100 help
```
