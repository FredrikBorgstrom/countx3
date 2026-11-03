export interface ParsedArgs {
	positional: string[];
	flags: Map<string, string | boolean>;
}

const camel = (flag: string) => flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** `--key value`, `--key=value`, `--flag`, `--no-flag`. Flag names are returned in camelCase. */
export function parseArgs(argv: string[]): ParsedArgs {
	const positional: string[] = [];
	const flags = new Map<string, string | boolean>();
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (!arg.startsWith('--')) {
			positional.push(arg);
			continue;
		}
		const body = arg.slice(2);
		const eq = body.indexOf('=');
		if (eq >= 0) {
			flags.set(camel(body.slice(0, eq)), body.slice(eq + 1));
		} else if (body.startsWith('no-')) {
			flags.set(camel(body.slice(3)), false);
		} else if (i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) {
			flags.set(camel(body), argv[++i]!);
		} else {
			flags.set(camel(body), true);
		}
	}
	return { positional, flags };
}

export const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
