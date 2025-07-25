# rad-debugger-communication
---

Taking advantage of rad debugger's inter-process communication feature, leverage a headless instance of rad debugger to drive another instance. In other words, we can set/unset/disable/enable breakpoints, set the target, auto-run and many more things, all with one button press from vscode. 

As a vscode user, all you have to do is make sure the config is set correctly (`rad-debugger-communication` in your settings), set/unset/enable/disable source breakpoints within vscode, and select "Launch Rad Debugging" from the vscode command palette.

## Features
---
* set source breakpoints in vscode and have them replicated to rad debugger.
* have the target auto-run from rad debugger.
* leave rad debugger open or have it automatically close when the target ends successfully (returns 0). 

### How To Make a Launch Configuration

1. Make sure your rad-debugger-communication settings are set correctly
2. Make a .vscode/launch.json like this (given 'build the executable' is a task in your .vscode/tasks.json):

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "build and debug",
      "type": "raddebugger",
      "request": "launch",
      "program": "",
      "preLaunchTask": "build the executable"
    }
  ]
}
```

If you leave the 'program' field blank, the launch config will use the target path from your settings at `rad-debugger-communication.targetPath` + `rad-debugger-communication.targetPathIsWorkspaceRelative`, exactly as if you had run the command from the command palette. If you want to have multiple target exes, you can optionally fill in the 'program' fields. Unlike in the settings, however, you should use standard launch.json / vscodey syntax for relative pathing. For example, `${workspaceFolder}/bin/game.exe`, which auto-resolves to a fully-qualified path on the backend.

Note that Rad Debugger will search the target's directory for .pdb files to gather debug information from. If you have custom pdb locations, you will have to give that information to Rad Debugger. 

If you want to request a feature, add issues at `https://github.com/TraceMyers/VSCode-Extension-Rad-Debugger-Communication` or email me at main@tracemyers.com.

## Requirements
---

## Extension Settings
---

* `rad-debugger-communication.targetPath`
* `rad-debugger-communication.targetPathIsWorkspaceRelative`
* `rad-debugger-communication.closeRaddbgOnProgramExit`
* `rad-debugger-communication.waitForRaddbgTimeout`
* `rad-debugger-communication.autoRun`
* `rad-debugger-communication.radDebuggerPath`

## Known Issues
---

## Release Notes
---

### 1.0.0

Initial release of the extension

### 1.0.1

Made it so raddbg.exe doesn't have to be in your PATH

### 1.1.0

Made it so you can create a launch configuration

### 1.1.1

Using launch config is faster by making sure raddbg is a detached process

## 1.1.2 - 1.1.3

Made it so you can customize the targets per launch config