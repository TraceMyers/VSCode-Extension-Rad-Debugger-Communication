import * as vscode from 'vscode';
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { DebugSession, InitializedEvent, TerminatedEvent } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';

interface BreakpointIR {
	path: string;
	enabled: boolean;
}

export const DEBUG = false;

export let project_path: string | undefined;
export let target_path: string | undefined;
export let quit_on_program_exit: boolean;
export let target_path_is_workspace_relative: boolean;
export let wait_for_process_timeout: number;
export let auto_run_target: boolean;
export let rad_debugger_path: string | undefined;

export function deactivate() {}

export function activate(context: vscode.ExtensionContext) {
	refreshConfig();

	// create a command to launch rad debugging
	const launchCommand = vscode.commands.registerCommand("rad-debugger-communication.launch", async () => { 
		const targetPath: string = target_path ?? "";
		runRadSession(targetPath); 
	});
	context.subscriptions.push(launchCommand);

	// gemini
	const debugConfigProvider: vscode.DebugConfigurationProvider = {
		resolveDebugConfiguration(folder, config, token) {
			 // If this is a new, empty configuration, provide some defaults.
            // This is crucial when the user hasn't set up a launch.json yet.
            if (!config.type && !config.request && !config.name) {
                config.type = "raddebugger";
                config.name = "Launch Rad Debugger";
                config.request = "launch";
                // Provide a sensible default for 'program' if it's not already set
                // You might want to make this configurable via extension settings
                if (!config.program) {
                    config.program = "${workspaceFolder}/main.exe"; // Or whatever your default target is
                }
            }

            // Ensure the type is correct for your debugger
            if (config.type !== "raddebugger") {
                // If it's not for your debugger type, let other providers handle it.
                // Or if it's an error, you can return undefined or throw.
                return undefined;
            }

            // Return the resolved configuration.
            return config;
		}
	};
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider("raddebugger", debugConfigProvider));

	// Register the Debug Adapter Descriptor Factory
    // This tells VS Code to use your RadDebuggerSpoofSession class as the debug adapter
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory("raddebugger", new InlineDebugAdapterFactory()));
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
	// breakpoints.forEach(bp => {
	// 	console.log("%s, %s", bp.path, String(bp.enabled));
	// });
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

async function runRadSession(targetPath: string) {
	// settings may have changed...
	refreshConfig();

	let targetIdentifier = "";
	let args: string[] = [];
	if (target_path !== undefined) {
		targetIdentifier += " " + targetPath;
		args.push(targetPath);
	}
	if (quit_on_program_exit) {
		targetIdentifier += " -q";
		args.push("-q");
	}
	
	let isRunning = await raddbgIsRunning();
	if (!isRunning) {
		// launch rad debugger 

		let runCommand = rad_debugger_path + targetIdentifier;
		console.log("running command", runCommand);
		const radPath: string = rad_debugger_path ?? "raddbg";

		// chatgpt helps for speed
		const subprocess = spawn(radPath, args, {
			detached: true,
			stdio: 'ignore', // <- this is crucial to fully detach
		});
		subprocess.unref(); // allow parent to exit independently

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
	let i = 0;
	for (const bp of vscode.debug.breakpoints) {
		if (bp instanceof vscode.SourceBreakpoint) {
			const breakpoint = getBreakpointIR(bp);
			const add_command = rad_debugger_path + " --ipc add_breakpoint " + breakpoint.path; 
			await run(add_command);

			// NOTE: this is fragile but I couldn't figure out how to use disable_breakpoint. should probably ask.
			// getting raddbg cursor/focus in the right place for disabling any future breakpoints
			if (i === 0) {
				// bring the breakpoints window to the front
				const focus_command = rad_debugger_path + " --ipc bring_to_front";
				await run(focus_command);
				// scroll up from bottom to the first breakpoitn
				const scroll_command_1 = rad_debugger_path + " --ipc move_up";
				await run(scroll_command_1);
				// scroll right to hover the breakpoint toggle switch
				const scroll_command_2 = rad_debugger_path + " --ipc move_right";
				await run(scroll_command_2);
			} else {
				// scroll down to the new breakpoint toggler
				const scroll_command = rad_debugger_path + " --ipc move_down";
				await run(scroll_command);
			}

			if (!bp.enabled) {
				// toggle the breakpoint off
				const command2 = rad_debugger_path + " --ipc accept";
				console.log("running " + command2);
				await run(command2);
			}
			i += 1;
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

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        // This will create an instance of our spoof debug adapter in the same process as the extension host
        console.log("Creating inline spoof debug adapter for session:", session.name);
        return new vscode.DebugAdapterInlineImplementation(new RadDebuggerSpoofSession());
    }
}

// gemini just spit out a bunch of code here that essentially tells vscode to do fuck all when starting a rad debugging session. 
// basically just deleted like half of it and made sure it called runRadSession()
class RadDebuggerSpoofSession extends DebugSession {

    public constructor() {
        super();
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        console.log("Spoof Debug Adapter: initializeRequest received");

        // Tell VS Code what capabilities your adapter supports.
        // For a spoof adapter, these can be minimal.
        response.body = {
            supportsConfigurationDoneRequest: true,
            supportsEvaluateForHovers: false,
            supportsStepBack: false,
            supportsDataBreakpoints: false,
            supportsFunctionBreakpoints: false,
            supportsConditionalBreakpoints: false,
            supportsLogPoints: false,
            supportsHitConditionalBreakpoints: false,
            supportsSetVariable: false,
            supportsRestartRequest: false,
            supportsGotoTargetsRequest: false,
            supportsCompletionsRequest: false,
            supportsModulesRequest: false,
            supportsLoadedSourcesRequest: false,
            supportsExceptionInfoRequest: false,
            supportsExceptionOptions: false,
            supportsValueFormattingOptions: false,
            supportsTerminateRequest: false,
            supportsRestartFrame: false,
            supportsSetExpression: false,
            supportsReadMemoryRequest: false,
            supportsDisassembleRequest: false,
            supportsTerminateThreadsRequest: false,
            supportsCancelRequest: false,
            // ... all other capabilities set to false or omitted
        };
        this.sendResponse(response);
        // Important: Tell VS Code that the adapter is initialized and ready for commands.
        this.sendEvent(new InitializedEvent());
    }

    protected launchRequest(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments, request?: DebugProtocol.Request): void {
		let programPath = (args as any).program;
		if (!programPath || programPath === "") {
			programPath = target_path;
		}
		runRadSession(programPath);
        this.sendResponse(response); // Send response immediately
        this.sendEvent(new TerminatedEvent()); // End the debug session
    }

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request): void {
        this.sendResponse(response);
    }
}