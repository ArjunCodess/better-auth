import { describe, expect, it, vi } from "vitest";

const headers = new Headers({ cookie: "session=abc" });
const jar = [{ name: "session", value: "abc" }];
let sessionReads = 0;

vi.mock("$app/server", () => ({
	getRequestEvent: () => ({
		request: { headers },
		cookies: { getAll: () => jar },
	}),
	query: (fn: () => Promise<unknown>) => {
		return () => ({
			refresh: async () => {
				sessionReads += 1;
				await fn();
			},
		});
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
			signInEmail: vi.fn(async () => {
				jar.splice(0, jar.length, { name: "session", value: "new" });
				return { token: "in" };
			}),
			signUpEmail: vi.fn(async () => ({ token: "up" })),
			signOut: vi.fn(async () => {
				jar.splice(0, jar.length);
				return { success: true };
			}),
			getSession: vi.fn(async () => ({ session: { id: "s" } })),
		},
	};
}

function cookieOf(call: { headers: Headers }) {
	return call.headers.get("cookie");
}

describe("createRemoteAuthClient", () => {
	it("signs in with the cookie jar and refreshes the session from it", async () => {
		const instance = auth();
		const client = createRemoteAuthClient(instance);
		sessionReads = 0;
		jar.splice(0, jar.length, { name: "session", value: "abc" });
		await client.signIn.email({
			email: "a@b.co",
			password: "secret",
			rememberMe: "on",
			callbackURL: "/dashboard",
		});
		expect(cookieOf(instance.api.signInEmail.mock.calls[0][0])).toBe(
			"session=abc",
		);
		expect(instance.api.signInEmail.mock.calls[0][0].body).toEqual({
			email: "a@b.co",
			password: "secret",
			callbackURL: "/dashboard",
			rememberMe: true,
		});
		expect(cookieOf(instance.api.getSession.mock.calls[0][0])).toBe(
			"session=new",
		);
		expect(sessionReads).toBe(1);
	});

	it("forwards number and boolean sign-up fields", async () => {
		const instance = auth();
		const client = createRemoteAuthClient(instance);
		await client.signUp.email({
			name: "Ada",
			email: "a@b.co",
			password: "secret",
			age: 31,
			admin: false,
		});
		expect(instance.api.signUpEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				body: expect.objectContaining({
					name: "Ada",
					email: "a@b.co",
					password: "secret",
					age: 31,
					admin: false,
				}),
			}),
		);
	});

	it("rejects a sign-up form that is missing the password", async () => {
		const instance = auth();
		const client = createRemoteAuthClient(instance);
		await expect(
			client.signUp.email({ name: "Ada", email: "a@b.co" }),
		).rejects.toBeTruthy();
		expect(instance.api.signUpEmail).not.toHaveBeenCalled();
	});

	it("drops the session cookie after sign-out and refreshes the query", async () => {
		const instance = auth();
		const client = createRemoteAuthClient(instance);
		sessionReads = 0;
		jar.splice(0, jar.length, { name: "session", value: "abc" });
		await client.signOut();
		expect(cookieOf(instance.api.signOut.mock.calls[0][0])).toBe("session=abc");
		expect(instance.api.getSession.mock.calls[0][0].headers.get("cookie")).toBe(
			null,
		);
		expect(sessionReads).toBe(1);
	});
});
