import { defineConfig, godoc } from "sourcey";

export default defineConfig({
  name: "chi",
  description: "Lightweight, idiomatic and composable router for building Go HTTP services",
  siteUrl: "https://kais12349.github.io",
  baseUrl: "/chi/",
  repo: "https://github.com/go-chi/chi",
  editBranch: "8b258c7bb28f97a5f2a856ff7ef962578fec9215",
  editBasePath: "",
  navigation: {
    tabs: [
      {
        tab: "Go API Reference",
        slug: "api",
        source: godoc({
          module: "..",
          packages: ["./..."],
          snapshot: "godoc.json",
          mode: "snapshot",
          includeTests: true,
          sourceBasePath: ""
        })
      }
    ]
  },
  navbar: {
    links: [
      { label: "Repository", href: "https://github.com/go-chi/chi" },
      { label: "pkg.go.dev", href: "https://pkg.go.dev/github.com/go-chi/chi/v5" }
    ]
  },
  footer: {
    links: [
      { label: "MIT License", href: "https://github.com/go-chi/chi/blob/master/LICENSE" }
    ]
  }
});
