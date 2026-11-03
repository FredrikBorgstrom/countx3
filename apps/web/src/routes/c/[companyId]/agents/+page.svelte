<script lang="ts">
	import type { Scope } from '@countx3/contracts';
	import { api, Countx3Error } from '#lib';
	import { API_URL } from '#lib/api.ts';
	import { m } from '#lib/paraglide/messages.js';
	import { invalidate } from '$app/navigation';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const presets: { id: string; label: () => string; hint: () => string; scopes: Scope[] }[] = [
		{ id: 'read', label: m.preset_read, hint: m.preset_read_hint, scopes: ['company:read', 'ledger:read'] },
		{
			id: 'assistant',
			label: m.preset_assistant,
			hint: m.preset_assistant_hint,
			scopes: ['company:read', 'ledger:read', 'ledger:write'],
		},
		{
			id: 'bookkeeper',
			label: m.preset_bookkeeper,
			hint: m.preset_bookkeeper_hint,
			scopes: ['company:read', 'ledger:read', 'ledger:write', 'ledger:book'],
		},
	];

	let name = $state('Claude Code');
	let client = $state('claude-code');
	let preset = $state('assistant');
	let created = $state<{ token: string; client: string } | null>(null);
	let error = $state('');
	const companyId = $derived(data.company.id);

	async function create(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		try {
			const scopes = presets.find((p) => p.id === preset)!.scopes;
			const token = await api.call('tokens.create', { name, client, scopes, companyId });
			created = { token: token.token, client };
			await invalidate('app:tokens');
		} catch (err) {
			error = err instanceof Countx3Error ? err.message : String(err);
		}
	}

	async function revoke(tokenId: string) {
		await api.call('tokens.revoke', { tokenId });
		await invalidate('app:tokens');
	}

	const snippets = $derived(
		created && {
			claude: `claude mcp add --transport http countx3 ${API_URL}/mcp \\\n  --header "Authorization: Bearer ${created.token}"`,
			codex: `# ~/.codex/config.toml\n[mcp_servers.countx3]\ncommand = "countx3"\nargs = ["mcp"]\nenv = { COUNTX3_URL = "${API_URL}", COUNTX3_TOKEN = "${created.token}", COUNTX3_COMPANY = "${companyId}" }`,
			cli: `export COUNTX3_URL=${API_URL}\nexport COUNTX3_TOKEN=${created.token}\nexport COUNTX3_COMPANY=${companyId}\ncountx3 vouchers list`,
		},
	);
</script>

<div class="stack">
	<div>
		<h1>{m.nav_agents()}</h1>
		<p class="muted">{m.agents_intro()}</p>
	</div>

	<form class="card stack" onsubmit={create}>
		<h2>{m.connect_agent()}</h2>
		<div class="row">
			<label>{m.token_name()}<input required bind:value={name} /></label>
			<label>
				{m.agent_client()}
				<select bind:value={client}>
					<option value="claude-code">Claude Code</option>
					<option value="codex">Codex</option>
					<option value="script">{m.other_script()}</option>
				</select>
			</label>
		</div>
		<fieldset class="presets">
			<legend>{m.permissions()}</legend>
			{#each presets as p (p.id)}
				<label class="preset">
					<input type="radio" name="preset" value={p.id} bind:group={preset} />
					<span><strong>{p.label()}</strong><br /><span class="muted">{p.hint()}</span></span>
				</label>
			{/each}
		</fieldset>
		{#if error}<p class="error">{error}</p>{/if}
		<div><button class="primary">{m.create_token()}</button></div>
	</form>

	{#if created && snippets}
		<section class="card stack">
			<h2>{m.token_created()}</h2>
			<p>{m.token_shown_once()}</p>
			<pre>{created.token}</pre>
			<h3>Claude Code</h3>
			<pre>{snippets.claude}</pre>
			<h3>Codex</h3>
			<pre>{snippets.codex}</pre>
			<h3>{m.cli_and_scripts()}</h3>
			<pre>{snippets.cli}</pre>
		</section>
	{/if}

	<section class="card table-wrap">
		<h2>{m.active_tokens()}</h2>
		<table>
			<thead>
				<tr><th>{m.token_name()}</th><th>{m.agent_client()}</th><th>{m.permissions()}</th><th>{m.last_used()}</th><th></th></tr>
			</thead>
			<tbody>
				{#each data.tokens as t (t.id)}
					<tr class:revoked={t.revokedAt}>
						<td>{t.name} <code class="muted">{t.prefix}…</code></td>
						<td>{t.client ?? ''}</td>
						<td>{t.scopes.join(', ')}</td>
						<td>{t.lastUsedAt?.slice(0, 16).replace('T', ' ') ?? m.never()}</td>
						<td>{#if t.revokedAt}<span class="badge">{m.revoked()}</span>{:else}<button class="danger" onclick={() => revoke(t.id)}>{m.revoke()}</button>{/if}</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="muted">{m.no_tokens()}</td></tr>
				{/each}
			</tbody>
		</table>
	</section>
</div>

<style>
	.presets {
		border: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.5rem;
	}

	.preset {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		color: var(--text);
		font-size: 0.95rem;
	}

	.revoked {
		color: var(--muted);
	}
</style>
