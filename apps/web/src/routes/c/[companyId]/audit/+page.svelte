<script lang="ts">
	import ActorBadge from '#lib/components/ActorBadge.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let open = $state<number | null>(null);
</script>

<div class="stack">
	<div>
		<h1>{m.nav_audit()}</h1>
		<p class="muted">{m.audit_intro()}</p>
	</div>
	<div class="card table-wrap">
		<table>
			<thead>
				<tr><th>{m.time()}</th><th>{m.by()}</th><th>{m.operation()}</th><th>{m.target()}</th></tr>
			</thead>
			<tbody>
				{#each data.items as e (e.id)}
					<tr class="clickable" onclick={() => (open = open === e.id ? null : e.id)}>
						<td class="nowrap">{e.at.slice(0, 19).replace('T', ' ')}</td>
						<td><ActorBadge actor={e.actor} /></td>
						<td><code>{e.operation}</code></td>
						<td class="muted">{e.targetType ?? ''}</td>
					</tr>
					{#if open === e.id}
						<tr><td colspan="4"><pre>{JSON.stringify(e.data, null, 2)}</pre></td></tr>
					{/if}
				{:else}
					<tr><td colspan="4" class="muted">{m.no_events()}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.clickable {
		cursor: pointer;
	}

	.nowrap {
		white-space: nowrap;
	}
</style>
