/**
 * Tests for THContainer — DI container with effect tracking.
 */
import { describe, it, expect, vi } from "vitest";
import { THContainer } from "./container.js";
import { defineService, valueProvider, factoryProvider } from "./service.js";

describe("THContainer", () => {
  // ── register and get ──

  it("register and get a service", () => {
    const container = new THContainer();
    const svc = defineService<string>("TestService");

    container.register(svc, valueProvider("hello"));

    expect(container.get(svc)).toBe("hello");
  });

  it("register with factory provider", () => {
    const container = new THContainer();
    const svc = defineService<{ value: number }>("ObjService");

    container.register(svc, factoryProvider(() => ({ value: 42 })));

    expect(container.get(svc)).toEqual({ value: 42 });
  });

  // ── get throws for unregistered service ──

  it("get throws for unregistered service", () => {
    const container = new THContainer();
    const svc = defineService<string>("Missing");

    expect(() => container.get(svc)).toThrow('Service "Missing" not found');
  });

  // ── has ──

  it("has() returns true for registered service", () => {
    const container = new THContainer();
    const svc = defineService<string>("Exists");
    container.register(svc, valueProvider("yes"));

    expect(container.has(svc)).toBe(true);
  });

  it("has() returns false for unregistered service", () => {
    const container = new THContainer();
    const svc = defineService<string>("Nope");

    expect(container.has(svc)).toBe(false);
  });

  // ── createChild inherits parent services ──

  it("createChild inherits parent services", () => {
    const parent = new THContainer();
    const svc = defineService<string>("Inherited");
    parent.register(svc, valueProvider("from-parent"));

    const child = parent.createChild();

    expect(child.get(svc)).toBe("from-parent");
    expect(child.has(svc)).toBe(true);
  });

  it("child can override parent service", () => {
    const parent = new THContainer();
    const svc = defineService<string>("Override");
    parent.register(svc, valueProvider("parent-value"));

    const child = parent.createChild();
    child.register(svc, valueProvider("child-value"));

    expect(child.get(svc)).toBe("child-value");
    expect(parent.get(svc)).toBe("parent-value");
  });

  // ── dispose cleans up effects ──

  it("dispose cleans up effects", async () => {
    const container = new THContainer();
    const disposeFn = vi.fn();
    container.effect("test-effect", disposeFn);

    await container.dispose();

    expect(disposeFn).toHaveBeenCalledOnce();
  });

  it("dispose prevents further use", async () => {
    const container = new THContainer();
    const svc = defineService<string>("Test");
    container.register(svc, valueProvider("value"));

    await container.dispose();

    expect(() => container.get(svc)).toThrow("Container already disposed");
  });

  it("dispose is idempotent", async () => {
    const container = new THContainer();
    const disposeFn = vi.fn();
    container.effect("once", disposeFn);

    await container.dispose();
    await container.dispose(); // should not throw

    expect(disposeFn).toHaveBeenCalledTimes(1);
  });

  // ── getAll ──

  it("getAll returns all providers for multi-provider service", () => {
    const container = new THContainer();
    const svc = defineService<string>("Multi");

    container.register(svc, valueProvider("a"), { id: "first" });
    container.register(svc, valueProvider("b"), { id: "second" });
    container.register(svc, valueProvider("c"), { id: "third" });

    const all = container.getAll(svc);
    expect(all).toEqual(["a", "b", "c"]);
  });

  it("getAll includes parent providers", () => {
    const parent = new THContainer();
    const svc = defineService<string>("MultiParent");
    parent.register(svc, valueProvider("p1"), { id: "parent1" });

    const child = parent.createChild();
    child.register(svc, valueProvider("c1"), { id: "child1" });

    const all = child.getAll(svc);
    expect(all).toContain("p1");
    expect(all).toContain("c1");
  });
});
