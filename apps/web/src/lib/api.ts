import { Countx3Error, createClient } from '@countx3/sdk';
import { goto } from '$app/navigation';

const TOKEN_KEY = 'countx3.session';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

const storage = {
	get: () => {
		try {
			return localStorage.getItem(TOKEN_KEY) ?? undefined;
		} catch {
			return undefined;
		}
	},
	set: (token: string | undefined) => {
		try {
			if (token) localStorage.setItem(TOKEN_KEY, token);
			else localStorage.removeItem(TOKEN_KEY);
		} catch {
			// Storage can be unavailable (private mode); the session then lasts for this page only.
		}
	},
};

let token = storage.get();

/** The same typed client the CLI uses; every screen talks to the API through the operation registry. */
export const api = createClient({ baseUrl: API_URL, token: () => token });

export const isSignedIn = () => token !== undefined;

export function setSession(sessionToken: string | undefined) {
	token = sessionToken;
	storage.set(sessionToken);
}

export async function signOut() {
	await api.auth.logOut().catch(() => undefined);
	setSession(undefined);
	await goto('/login');
}

/** Sends the user to login when the session has expired; rethrows everything else. */
export async function guard<T>(promise: Promise<T>): Promise<T> {
	try {
		return await promise;
	} catch (error) {
		if (error instanceof Countx3Error && error.code === 'UNAUTHENTICATED') {
			setSession(undefined);
			await goto('/login');
		}
		throw error;
	}
}

export { Countx3Error };
