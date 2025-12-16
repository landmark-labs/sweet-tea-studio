---
description: Environment configuration and command syntax guidelines
---

# Operating Environment

This project operates in a **Windows environment** with **PowerShell** as the default shell.

## Command Syntax Guidelines

When running commands, always use PowerShell-compatible syntax:

1. **Path separators**: Use backslashes (`\`) or forward slashes (`/`) - PowerShell accepts both
2. **Environment variables**: Use `$env:VARIABLE_NAME` instead of `$VARIABLE_NAME`
3. **Command chaining**: Use `;` instead of `&&` for sequential commands
4. **Null redirection**: Use `$null` instead of `/dev/null`
5. **String quotes**: Prefer double quotes for variable interpolation, single quotes for literals

## Common Command Translations

| Unix/Bash | PowerShell |
|-----------|------------|
| `export VAR=value` | `$env:VAR = "value"` |
| `command1 && command2` | `command1; if ($?) { command2 }` |
| `command > /dev/null` | `command > $null` |
| `cat file.txt` | `Get-Content file.txt` or `cat file.txt` |
| `rm -rf folder` | `Remove-Item -Recurse -Force folder` |
| `mkdir -p path/to/dir` | `New-Item -ItemType Directory -Force -Path path\to\dir` |
| `cp -r src dest` | `Copy-Item -Recurse src dest` |
| `which command` | `Get-Command command` |

## npm/Node.js Commands

These work the same in PowerShell:
- `npm install`
- `npm run dev`
- `npx` commands

## Python Commands

These work the same in PowerShell:
- `python` or `py`
- `pip install`
- `uvicorn` and other Python tools
