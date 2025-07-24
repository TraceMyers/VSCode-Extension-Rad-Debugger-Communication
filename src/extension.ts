import * as vscode from 'vscode';
import { exec } from "child_process";
import { promisify } from "util";

interface BreakpointIR {
	path: string;
	enabled: boolean;
}

export const DEBUG = false;

export const breakpoints: BreakpointIR[] = [];
export let project_path: string | undefined;
export let target_path: string | undefined;
export let quit_on_program_exit: boolean;
export let target_path_is_workspace_relative: boolean;
export let wait_for_process_timeout: number;
export let auto_run_target: boolean;
export let rad_debugger_path: string | undefined;

export function activate(context: vscode.ExtensionContext) {
	refreshConfig();

	// collect breakpoints that were loaded from the sql database / vscode state
	vscode.debug.breakpoints.forEach(breakpoint => {
		if (breakpoint instanceof vscode.SourceBreakpoint) {
			addUnique(breakpoints, getBreakpointIR(breakpoint));
		}
	});
	logState();

	// create a listener to maintain the list of breakpoints through edit events
	const breakpointsChangeListener = vscode.debug.onDidChangeBreakpoints((event) => {
		event.added.forEach(breakpoint => {
			if (breakpoint instanceof vscode.SourceBreakpoint) {
				addUnique(breakpoints, getBreakpointIR(breakpoint));
				logState();
			}
		});
		event.removed.forEach(breakpoint => {
			if (breakpoint instanceof vscode.SourceBreakpoint) {
				removeAll(breakpoints, getBreakpointIR(breakpoint));
				logState();
			}
		});
		event.changed.forEach(breakpoint => {
			if (breakpoint instanceof vscode.SourceBreakpoint) {
				const ir = getBreakpointIR(breakpoint);
				const index = findBreakpointIRIndex(breakpoints, ir);
				if (index !== -1) {
					breakpoints[index].enabled = breakpoint.enabled;
				} else { // error? assume we need to add...
					breakpoints.push(ir);
				}
				logState();
			}
		});
	});
	context.subscriptions.push(breakpointsChangeListener);

	// create a command to launch rad debugging
	const launchCommand = vscode.commands.registerCommand("rad-debugger-communication.launch", async () => {
		// settings may have changed...
		refreshConfig();

		let targetIdentifier = "";
		if (target_path !== undefined) {
			targetIdentifier += " " + target_path;
		}
		if (quit_on_program_exit) {
			targetIdentifier += " -q";
		}
		
		let isRunning = await raddbgIsRunning();
		if (!isRunning) {
			// launch rad debugger 
			let runCommand = rad_debugger_path + targetIdentifier;
			console.log("running command", runCommand);
			exec(runCommand, (error, stdout, stderr) => {
				if (error) {
					console.error("failed launching...?");
				}
			});

			let i = 0;
			const waitTimeMs = 100;
			let sanityIterMax = Math.max((wait_for_process_timeout / waitTimeMs) * 2, 1);
			let timeoutTimer = wait_for_process_timeout;
			let prevDate = new Date();

			// tested, this is super innacurate waiting but it works alright. it seems generous.
			while (true) {
				if (timeoutTimer <= 0 || i >= sanityIterMax) {
					break;
				}
				isRunning = await raddbgIsRunning();
				if (isRunning) {
					break;
				}
				const newDate = new Date();
				const timeDiff = Math.max(newDate.getMilliseconds() - prevDate.getMilliseconds(), 0);
				prevDate = newDate;
				timeoutTimer -= timeDiff;
				await sleep(waitTimeMs);
				i += 1;
			}
		}

		if (!isRunning) {
			console.log("failed to spawn raddbg instance, or failed to detect the instance is running.");
			return;
		}

		// clear all breakpoints in raddbg
		await run(rad_debugger_path + " --ipc clear_breakpoints");

		// add all breakpoints from vscode
		for (const bp of breakpoints) {
			if (bp.enabled) {
				const command = rad_debugger_path + " --ipc add_breakpoint " + bp.path; 
				await run(command);
			}
		}

		if (auto_run_target) {
			// make sure the target we're running is enabled
			const enableTargetCommand = rad_debugger_path + " --ipc enable_target" + targetIdentifier;
			await run(enableTargetCommand);
			// run exe and debug (actually runs all targets ewwwwww)
			const launchAndRunExeCommand = rad_debugger_path + " --ipc run";
			await run(launchAndRunExeCommand);
		}
	});
	context.subscriptions.push(launchCommand);
}

function getBreakpointPath(breakpoint: vscode.SourceBreakpoint): string {
	const location = breakpoint.location;
	const fileLoc = location.uri.fsPath;
	const lineNumber = location.range.start.line;
	const breakpointPath = fileLoc + ":" + (lineNumber + 1);
	return breakpointPath;
}

function getBreakpointIR(breakpoint: vscode.SourceBreakpoint): BreakpointIR {
	const path = getBreakpointPath(breakpoint);
	const enabled = breakpoint.enabled;
	return {path, enabled};
}

// thanks gemini
function removeAll(arr: BreakpointIR[], value: BreakpointIR) {
	let i = 0;
	while (i < arr.length) {
		if (arr[i].path === value.path) {
			arr.splice(i, 1);
		} else {
			i += 1;
		}
	}
}

async function raddbgIsRunning(): Promise<boolean> {
	const isRunning = (async () => {
		return await isProcessRunning('raddbg'); // Replace with your desired process name
	})();
	return isRunning;
}

// thanks gemini
async function isProcessRunning(processName: string): Promise<boolean> {
  let cmd: string;

  switch (process.platform) {
    case 'win32':
      cmd = `tasklist`; // list all processes on Windows
      break;
    case 'darwin':
      cmd = `pgrep -l ${processName} | awk '{ print $2 }'`; // use pgrep and awk on macOS
      break;
    case 'linux':
      cmd = `pgrep -l ${processName} | awk '{ print $2 }'`; // use pgrep and awk on Linux
      break;
    default:
      return false; // Unsupported platform
  }

  return new Promise((resolve, reject) => {
    exec(cmd, (err: Error | null, stdout: string) => {
      if (err) {
        reject(err);
      }
      resolve(stdout.toLowerCase().includes(processName.toLowerCase())); // Check if process name is in the output
    });
  });
}

function findBreakpointIRIndex(arr: BreakpointIR[], value: BreakpointIR): number {
	let i = 0;
	while (i < arr.length) {
		if (arr[i].path === value.path) {
			return i;
		}
		i += 1;
	}
	return -1;
}

function addUnique(arr: BreakpointIR[], value: BreakpointIR) {
	const itemIndex = findBreakpointIRIndex(arr, value);
	if (itemIndex === -1) {
		arr.push(value);
	}
}

async function logState() {
	console.log("new breakpoints state:");
	breakpoints.forEach(bp => {
		console.log("%s, %s", bp.path, String(bp.enabled));
	});
	if (DEBUG) {
		// reason for DEBUG: it's not ideal to be waiting on this every time
		const isRunning: boolean = await raddbgIsRunning();
		console.log("raddbg is running:", isRunning);
	}
}

function refreshConfig() {
	const config = vscode.workspace.getConfiguration("rad-debugger-communication");
	target_path = config.get("targetPath");
	quit_on_program_exit = config.get("closeRaddbgOnProgramExit") ?? true;
	target_path_is_workspace_relative = config.get("targetPathIsWorkspaceRelative") ?? true;
	wait_for_process_timeout = config.get("waitForRaddbgTimeout") ?? 500;
	auto_run_target = config.get("autoRun") ?? true;
	rad_debugger_path = config.get("radDebuggerPath");

	// establish workspace directory
	if (vscode.workspace.workspaceFolders !== undefined) {
		project_path = vscode.workspace.workspaceFolders[0].uri.fsPath;
		console.log("project path", project_path);
	} else {
		project_path = undefined;
		return;
	}
	if (target_path_is_workspace_relative) {
		target_path = project_path + "/" + target_path;
	}
}

// thanks chatgpt
const execAsync = promisify(exec);

// thanks chatgpt
async function run(commandString: string) {
  try {
    await execAsync(commandString);
  } catch (error) {
    console.error('exec error:', error);
  }
}

// thanks gemini
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// This method is called when your extension is deactivated
export function deactivate() {}
