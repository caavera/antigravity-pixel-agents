import * as vscode from 'vscode';
import type { AgentState, PersistedAgent } from './types.js';
import { TERMINAL_NAME_PREFIX, WORKSPACE_KEY_AGENTS, WORKSPACE_KEY_AGENT_SEATS } from './constants.js';
import { migrateAndLoadLayout } from './layoutPersistence.js';
import { AntigravityTracker, AgentStateValue } from './antigravityTracker.js';

export function launchNewTerminal(
	nextAgentIdRef: { current: number },
	nextTerminalIndexRef: { current: number },
	agents: Map<number, AgentState>,
	activeAgentIdRef: { current: number | null },
	webview: vscode.Webview | undefined,
	persistAgents: () => void,
): void {
	const id = nextAgentIdRef.current++;

	const tracker = new AntigravityTracker((state, description) => {
		const agent = agents.get(id);
		if (agent) {
			agent.currentState = state;
			agent.currentStatusDescription = description;

			if (state === 'idle') {
				webview?.postMessage({ type: 'agentStatus', id, status: 'waiting' });
				webview?.postMessage({ type: 'agentToolsClear', id });
			} else {
				webview?.postMessage({ type: 'agentStatus', id, status: 'active' });
				// Send a fake tool event to display the status text
				webview?.postMessage({
					type: 'agentToolStart',
					id,
					toolId: 'antigravity-status',
					status: description || state,
				});
			}
		}
	});

	const agent: AgentState = {
		id,
		tracker,
		currentState: 'idle',
	};

	agents.set(id, agent);
	activeAgentIdRef.current = id;
	persistAgents();
	console.log(`[Pixel Agents] Agent ${id} created`);
	webview?.postMessage({ type: 'agentCreated', id });
	// Initial state
	webview?.postMessage({ type: 'agentStatus', id, status: 'waiting' });
}

export function removeAgent(
	agentId: number,
	agents: Map<number, AgentState>,
	persistAgents: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent) { return; }

	if (agent.tracker) {
		agent.tracker.dispose();
	}

	agents.delete(agentId);
	persistAgents();
}

export function persistAgents(
	agents: Map<number, AgentState>,
	context: vscode.ExtensionContext,
): void {
	const persisted: PersistedAgent[] = [];
	for (const agent of agents.values()) {
		persisted.push({
			id: agent.id,
		});
	}
	context.workspaceState.update(WORKSPACE_KEY_AGENTS, persisted);
}

export function restoreAgents(
	context: vscode.ExtensionContext,
	nextAgentIdRef: { current: number },
	nextTerminalIndexRef: { current: number },
	agents: Map<number, AgentState>,
	activeAgentIdRef: { current: number | null },
	webview: vscode.Webview | undefined,
	doPersist: () => void,
): void {
	const persisted = context.workspaceState.get<PersistedAgent[]>(WORKSPACE_KEY_AGENTS, []);
	if (persisted.length === 0) { return; }

	let maxId = 0;

	for (const p of persisted) {
		const tracker = new AntigravityTracker((state, description) => {
			const agent = agents.get(p.id);
			if (agent) {
				agent.currentState = state;
				agent.currentStatusDescription = description;

				if (state === 'idle') {
					webview?.postMessage({ type: 'agentStatus', id: p.id, status: 'waiting' });
					webview?.postMessage({ type: 'agentToolsClear', id: p.id });
				} else {
					webview?.postMessage({ type: 'agentStatus', id: p.id, status: 'active' });
					webview?.postMessage({
						type: 'agentToolStart',
						id: p.id,
						toolId: 'antigravity-status',
						status: description || state,
					});
				}
			}
		});

		const agent: AgentState = {
			id: p.id,
			tracker,
			currentState: 'idle',
		};

		agents.set(p.id, agent);
		console.log(`[Pixel Agents] Restored agent ${p.id}`);

		if (p.id > maxId) { maxId = p.id; }
	}

	if (maxId >= nextAgentIdRef.current) {
		nextAgentIdRef.current = maxId + 1;
	}

	doPersist();
}

export function sendExistingAgents(
	agents: Map<number, AgentState>,
	context: vscode.ExtensionContext,
	webview: vscode.Webview | undefined,
): void {
	if (!webview) { return; }
	const agentIds: number[] = [];
	for (const id of agents.keys()) {
		agentIds.push(id);
	}
	agentIds.sort((a, b) => a - b);

	const agentMeta = context.workspaceState.get<Record<string, { palette?: number; seatId?: string }>>(WORKSPACE_KEY_AGENT_SEATS, {});

	webview.postMessage({
		type: 'existingAgents',
		agents: agentIds,
		agentMeta,
	});

	sendCurrentAgentStatuses(agents, webview);
}

export function sendCurrentAgentStatuses(
	agents: Map<number, AgentState>,
	webview: vscode.Webview | undefined,
): void {
	if (!webview) { return; }
	for (const [agentId, agent] of agents) {
		if (agent.currentState === 'idle') {
			webview.postMessage({
				type: 'agentStatus',
				id: agentId,
				status: 'waiting',
			});
		} else {
			webview.postMessage({
				type: 'agentStatus',
				id: agentId,
				status: 'active',
			});
			webview.postMessage({
				type: 'agentToolStart',
				id: agentId,
				toolId: 'antigravity-status',
				status: agent.currentStatusDescription || agent.currentState,
			});
		}
	}
}

// Keeping this for backwards compatibility, though we don't track project dirs directly anymore
export function getProjectDirPath(cwd?: string): string | null {
	return cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
}

export function sendLayout(
	context: vscode.ExtensionContext,
	webview: vscode.Webview | undefined,
	defaultLayout?: Record<string, unknown> | null,
): void {
	if (!webview) { return; }
	const layout = migrateAndLoadLayout(context, defaultLayout);
	webview.postMessage({
		type: 'layoutLoaded',
		layout,
	});
}
