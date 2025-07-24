# rad-debugger-communication README

Taking advantage of rad debugger's inter-process communication feature, leverage a headless instance of rad debugger to drive another instance. In other words, we can set/unset/disable/enable breakpoints, set the target, auto-run and many more things, all with one button press from vscode. 

As a vscode user, all you have to do is make sure the config is set correctly (`rad-debugger-communication` in your settings), set/unset/enable/disable source breakpoints within vscode, and select "Launch Rad Debugging" from the vscode command palette.

## Features

* set source breakpoints in vscode and have them replicated to rad debugger.
* have the target auto-run from rad debugger.
* leave rad debugger open or have it automatically close when the target ends successfully (returns 0). 

## Requirements

---

## Extension Settings

* `rad-debugger-communication.targetPath`
* `rad-debugger-communication.targetPathIsWorkspaceRelative`
* `rad-debugger-communication.closeRaddbgOnProgramExit`
* `rad-debugger-communication.waitForRaddbgTimeout`
* `rad-debugger-communication.autoRun`
* `rad-debugger-communication.radDebuggerPath`

## Known Issues

---

## Release Notes

### 1.0.0

Initial release of the extension

### 1.0.1

Made it so raddbg.exe doesn't have to be in your PATH