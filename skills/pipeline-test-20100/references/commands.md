# pipeline-test-20100 — Command Reference

## Command Groups



## Command Routing Logic

```javascript
// Parse command from input:
// /pipeline-test-20100 <command> [args]
const parts = input.trim().split(/\\s+/);
const command = parts[0] || 'default';
const params = { _raw: parts.slice(1).join(' ') };
```
