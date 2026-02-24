import * as vscode from 'vscode';

export type AgentStateValue = 'idle' | 'writing' | 'reading' | 'running_command' | 'planning';

export class AntigravityTracker {
    private currentState: AgentStateValue = 'idle';
    private idleTimeout: NodeJS.Timeout | null = null;

    // Callback to send the new state to the Webview
    private onStateChange: (state: AgentStateValue, description?: string) => void;
    private disposables: vscode.Disposable[] = [];

    constructor(onStateChange: (state: AgentStateValue, description?: string) => void) {
        this.onStateChange = onStateChange;
        this.startTracking();
    }

    private setState(newState: AgentStateValue, description?: string) {
        if (this.currentState !== newState) {
            this.currentState = newState;
            this.onStateChange(newState, description);
        }

        // Reset idle timer
        if (this.idleTimeout) {
            clearTimeout(this.idleTimeout);
        }

        this.idleTimeout = setTimeout(() => {
            if (this.currentState !== 'idle') {
                this.currentState = 'idle';
                this.onStateChange('idle');
            }
        }, 3000); // Return to idle after 3s of inactivity
    }

    private startTracking() {
        // 1. Detect artifact creation/modification (Planning)
        const generateArtifactPattern = '**/*.md';
        const artifactWatcher = vscode.workspace.createFileSystemWatcher(generateArtifactPattern);

        this.disposables.push(
            artifactWatcher.onDidCreate(uri => {
                if (uri.fsPath.includes('.gemini') || uri.fsPath.includes('brain')) {
                    this.setState('planning', 'Planning task...');
                }
            }),
            artifactWatcher.onDidChange(uri => {
                if (uri.fsPath.includes('.gemini') || uri.fsPath.includes('brain')) {
                    this.setState('planning', 'Updating plan...');
                }
            }),
            artifactWatcher
        );

        // 2. Detect code editing (Writing)
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                // Ignore non-file schemes and hidden/git files
                if (event.document.uri.scheme !== 'file') { return; }
                if (event.document.uri.fsPath.includes('.git')) { return; }

                // If it's a large change, it's likely the AI writing
                const isLargeChange = event.contentChanges.some(change => change.text.length > 50);

                if (isLargeChange || !vscode.window.activeTextEditor || vscode.window.activeTextEditor.document !== event.document) {
                    this.setState('writing', `Writing ${vscode.workspace.asRelativePath(event.document.uri)}`);
                }
            })
        );

        // 3. Detect terminal usage (Running commands)
        // using onDidStartTerminalShellExecution / onDidEndTerminalShellExecution
        if (vscode.window.onDidStartTerminalShellExecution) {
            this.disposables.push(
                vscode.window.onDidStartTerminalShellExecution(e => {
                    const cmd = e.execution?.commandLine?.value || "command";
                    this.setState('running_command', `Running: ${cmd}`);
                }),
                vscode.window.onDidEndTerminalShellExecution(e => {
                    this.setState('idle', 'Finished command');
                })
            );
        }

        // 4. Detect file reading and tool analytical work (Reading/Thinking)
        // Antigravity writes internal logs to .system_generated/logs when it uses tools like grep/view_file
        const internalLogsPattern = '**/.system_generated/**/*';
        const logsWatcher = vscode.workspace.createFileSystemWatcher(internalLogsPattern);

        this.disposables.push(
            logsWatcher.onDidChange(uri => {
                if (this.currentState === 'idle' || this.currentState === 'planning') {
                    this.setState('reading', 'Analyzing/Reading...');
                }
            }),
            logsWatcher.onDidCreate(uri => {
                if (this.currentState === 'idle' || this.currentState === 'planning') {
                    this.setState('reading', 'Analyzing/Reading...');
                }
            }),
            logsWatcher
        );

        // Also detect generic file reading through open text document
        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument(doc => {
                if (doc.uri.scheme === 'file' && !doc.uri.fsPath.includes('.git') && !doc.uri.fsPath.includes('.system_generated')) {
                    if (this.currentState === 'idle' || this.currentState === 'planning') {
                        this.setState('reading', `Reading ${vscode.workspace.asRelativePath(doc.uri)}`);
                    }
                }
            })
        );
    }

    public dispose() {
        if (this.idleTimeout) {
            clearTimeout(this.idleTimeout);
        }
        this.disposables.forEach(d => d.dispose());
    }
}
