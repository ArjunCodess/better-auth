import * as z from "zod";
import { command, form, getRequestEvent, query } from "$app/server";

/**
 * Server auth instance. Remote functions call `auth.api` on the server.
 * Install the `sveltekitCookies` plugin so `Set-Cookie` from these calls
 * is written onto the current SvelteKit request.
 */
export type RemoteAuth = {
	api: {
		signInEmail: (context: {
			body: {
				email: string;
				password: string;
				callbackURL?: string;
				rememberMe?: boolean;
			};
			headers: Headers;
		}) => Promise<unknown>;
		signUpEmail: (context: {
			body: {
				name: string;
				email: string;
				password: string;
				image?: string;
				callbackURL?: string;
				rememberMe?: boolean;
			} & Record<string, unknown>;
			headers: Headers;
		}) => Promise<unknown>;
		signOut: (context: { headers: Headers }) => Promise<unknown>;
		getSession: (context: { headers: Headers }) => Promise<unknown>;
	};
};

const emailSignInSchema = z.object({
	email: z.string(),
	password: z.string(),
	callbackURL: z.string().optional(),
	rememberMe: z.string().optional(),
});

const emailSignUpSchema = z
	.object({
		name: z.string(),
		email: z.string(),
		password: z.string(),
		image: z.string().optional(),
		callbackURL: z.string().optional(),
		rememberMe: z.string().optional(),
	})
	.catchall(z.string());

function requestHeaders() {
	return getRequestEvent().request.headers;
}

function rememberMeFromForm(value: string | undefined) {
	if (value === undefined) return undefined;
	return value === "on" || value === "true";
}

/**
 * SvelteKit remote client for email sign-in, email sign-up, sign-out, and
 * the current session.
 *
 * Import this from a `.remote.ts` file. It is a separate export from
 * `better-auth/svelte` because that entry is loaded in the browser, and
 * these functions import `$app/server`.
 *
 * OAuth callbacks, magic links, and WebAuthn stay on the existing handler.
 *
 * @example
 * ```ts
 * // src/lib/auth.remote.ts
 * import { createRemoteAuthClient } from "better-auth/svelte/remote";
 * import { auth } from "$lib/server/auth";
 *
 * export const { signIn, signUp, signOut, useSession } =
 *   createRemoteAuthClient(auth);
 * ```
 */
export function createRemoteAuthClient<Auth extends RemoteAuth>(auth: Auth) {
	const useSession = query(async () => {
		return auth.api.getSession({ headers: requestHeaders() });
	});

	const signInEmail = form(
		emailSignInSchema,
		async ({ email, password, callbackURL, rememberMe }) => {
			// Do not refresh useSession here. sveltekitCookies writes the new
			// cookie with event.cookies.set, and request.headers still hold
			// the pre-sign-in cookie, so a refresh would cache a signed-out session.
			return auth.api.signInEmail({
				body: {
					email,
					password,
					...(callbackURL ? { callbackURL } : {}),
					rememberMe: rememberMeFromForm(rememberMe),
				},
				headers: requestHeaders(),
			});
		},
	);

	const signUpEmail = form(emailSignUpSchema, async (data) => {
		const { name, email, password, image, callbackURL, rememberMe, ...extra } =
			data;
		return auth.api.signUpEmail({
			body: {
				name,
				email,
				password,
				...(image ? { image } : {}),
				...(callbackURL ? { callbackURL } : {}),
				...(rememberMe !== undefined
					? { rememberMe: rememberMeFromForm(rememberMe) }
					: {}),
				...extra,
			},
			headers: requestHeaders(),
		});
	});

	const signOut = command(async () => {
		return auth.api.signOut({ headers: requestHeaders() });
	});

	return {
		signIn: { email: signInEmail },
		signUp: { email: signUpEmail },
		signOut,
		useSession,
	};
}
