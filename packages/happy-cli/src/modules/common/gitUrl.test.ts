import { describe, it, expect } from "vitest";
import { parseHostEntry, parseCloneCoordinates, resolveCloneUrl } from "./gitUrl";

describe("parseHostEntry", () => {
  it("splits a protocol-qualified host and strips a trailing slash", () => {
    expect(parseHostEntry("https://gitea.example.com/")).toEqual({
      bare: "gitea.example.com",
      protocol: "https",
    });
    expect(parseHostEntry("http://localhost:3000")).toEqual({
      bare: "localhost:3000",
      protocol: "http",
    });
  });

  it("returns a bare host with null protocol when none is given", () => {
    expect(parseHostEntry("github.com")).toEqual({ bare: "github.com", protocol: null });
  });
});

describe("parseCloneCoordinates", () => {
  it("parses scp-style SSH with and without .git", () => {
    expect(parseCloneCoordinates("git@github.com:owner/repo.git")).toEqual({
      host: "github.com",
      owner: "owner",
      repo: "repo",
    });
    expect(parseCloneCoordinates("git@github.com:owner/repo")).toEqual({
      host: "github.com",
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses ssh:// scheme URLs", () => {
    expect(parseCloneCoordinates("ssh://git@gitea.example.com/owner/repo.git")).toEqual({
      host: "gitea.example.com",
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses HTTPS URLs", () => {
    expect(parseCloneCoordinates("https://github.com/owner/repo.git")).toEqual({
      host: "github.com",
      owner: "owner",
      repo: "repo",
    });
  });

  it("trims surrounding whitespace before matching", () => {
    expect(parseCloneCoordinates("  git@github.com:owner/repo.git  ")?.repo).toBe("repo");
  });

  it("returns null for an unrecognized shape", () => {
    expect(parseCloneCoordinates("not-a-url")).toBeNull();
    expect(parseCloneCoordinates("")).toBeNull();
  });
});

describe("resolveCloneUrl", () => {
  it("passes HTTPS URLs through unchanged", () => {
    const url = "https://github.com/owner/repo.git";
    expect(resolveCloneUrl(url)).toBe(url);
  });

  it("rebuilds an SSH URL as HTTPS using the parsed host", () => {
    expect(resolveCloneUrl("git@github.com:owner/repo.git")).toBe(
      "https://github.com/owner/repo.git",
    );
  });

  it("honors a configured host's protocol and bare host", () => {
    expect(resolveCloneUrl("git@ignored.example.com:owner/repo", "http://internal.git")).toBe(
      "http://internal.git/owner/repo.git",
    );
  });

  it("returns unparseable input unchanged", () => {
    expect(resolveCloneUrl("garbage")).toBe("garbage");
  });
});
