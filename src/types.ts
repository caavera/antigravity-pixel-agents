import type * as vscode from 'vscode';
import type { AntigravityTracker, AgentStateValue } from './antigravityTracker.js';

export interface AgentState {
	id: number;
	terminalRef?: vscode.Terminal; // Made optional as it might not be bound to a terminal
	tracker?: AntigravityTracker;
	currentState: AgentStateValue;
	currentStatusDescription?: string;
}

export interface PersistedAgent {
	id: number;
}
