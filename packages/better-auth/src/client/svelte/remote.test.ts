import { describe, expect, it, vi } from "vitest";

const headers = new Headers({ cookie: "session=abc" });
let sessionReads = 0;

vi.mock("$app/server", () => ({
	getRequestEvent: () => ({ request: { headers } }),
	query: (fn: () => Promise<unknown>) => {
		let current: Promise<unknown> | undefined;
		const run = () => {
			sessionReads += 1;
			current = fn();
			return current;
		};
		const queryFn = () => current ?? run();
		queryFn.refresh = async () => {
			await run();
		};
		return queryFn;
	},
	form: (
		schema: {
			safeParse: (data: unknown) => {
				success: boolean;
				data?: unknown;
				error?: unknown;
			};
		},
		fn: (data: unknown) => Promise<unknown>,
	) => {
		return async (data: unknown) => {
			const parsed = schema.safeParse(data);
			if (!parsed.success) {
				throw parsed.error;
			}
			return fn(parsed.data);
		};
	},
	command: (fn: () => Promise<unknown>) => fn,
}));

import { createRemoteAuthClient } from "./remote";

function auth() {
	return {
		api: {
			signInEmail: vi.fn(async () => ({ token: "in" })),
			signUpEmail: vi.fn(async () => ({ token: "up" })),
			signOut: vi.fn(async () => ({ success: true })),
			getSession: vi.fn(async () => ({ session: { id: "s" } })),
		},
	};
}

describe("createRemoteAuthClient", () => {
	it("signs in with the request headers and does not reread the old cookie", async () => {
		const instance = auth();
		const client = createRemoteAuthClient(instance);
		sessionReads = 0;
		await client.signIn.email({
			email: "a@b.co",
			password: "secret",
			rememberMe: "on",
			callbackURL: "/dashboard",
		});
		expect(instance.api.signInEmail).toHaveBeenCalledWith({
			body: {
				email: "a@b.co",
				password: "secret",
				callbackURL: "/dashboard",
				rememberMe: true,
			},
			headers,
		});
		expect(sessionReads).toBe(0);
	});

	it("forwards extra sign-up fields and rememberMe", async () => {
		const instance = auth();
		const client = createRemoteAuthClient(instance);
		await client.signUp.email({
			name: "Ada",
			email: "a@b.co",
			password: "secret",
			callbackURL: "/welcome",
			rememberMe: "true",
			company: "Analytical",
		});
		expect(instance.api.signUpEmail).toHaveBeenCalledWith({
			body: {
				name: "Ada",
				email: "a@b.co",
				password: "secret",
				callbackURL: "/welcome",
				rememberMe: true,
				company: "Analytical",
			},
			headers,
		});
	});

	it("rejects a sign-up form that is missing the password", async () => {
		const instance = auth();
		const client = createRemoteAuthClient(instance);
		await expect(
			client.signUp.email({ name: "Ada", email: "a@b.co" }),
		).rejects.toBeTruthy();
		expect(instance.api.signUpEmail).not.toHaveBeenCalled();
	});

	it("signs out and reads the session once until refresh", async () => {
		const instance = auth();
		const client = createRemoteAuthClient(instance);
		sessionReads = 0;
		await client.signOut();
		expect(instance.api.signOut).toHaveBeenCalledWith({ headers });
		await client.useSession();
		await client.useSession();
		expect(sessionReads).toBe(1);
		expect(instance.api.getSession).toHaveBeenCalledTimes(1);
	});
});
