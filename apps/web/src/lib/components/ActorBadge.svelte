<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';

	let { actor }: { actor: { type: string; name: string; client?: string | undefined } } = $props();
</script>

{#if actor.type === 'agent'}
	<span class="badge agent" title={actor.client ? `${actor.name} (${actor.client})` : actor.name}>
		{m.actor_agent({ name: actor.client ?? actor.name })}
	</span>
{:else}
	<span class="badge">{actor.name}</span>
{/if}
