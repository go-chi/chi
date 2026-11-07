// This example demonstrates how to serve a Single Page Application (SPA)
// that is embedded in the binary, next to a JSON API.
//
// Requests that match an API route are handled by the API. Requests that match
// a static file are served from the embedded filesystem. Any other request,
// including directories such as /images/, falls back to index.html so the
// client side router can handle it, and directory listings are never shown.
//
// Boot the server:
//
//	$ go run main.go
//
// Client requests:
//
//	$ curl http://localhost:3333/api/hello
//	{"message":"hello from the API"}
//
//	$ curl http://localhost:3333/images/logo.svg
//	<svg ...>
//
//	$ curl http://localhost:3333/some/client/route
//	<!doctype html> ... (index.html)
//
//	$ curl http://localhost:3333/images/
//	<!doctype html> ... (index.html, not a directory listing)
//
//	$ curl -i http://localhost:3333/api/missing
//	HTTP/1.1 404 Not Found
package main

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

//go:embed static
var staticFiles embed.FS

func main() {
	r := chi.NewRouter()
	r.Use(middleware.Logger)

	// The API lives in its own sub-router, so unknown API routes return a real
	// 404 instead of falling through to the SPA.
	r.Route("/api", func(r chi.Router) {
		r.Get("/hello", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"message":"hello from the API"}`))
		})
	})

	// Every other GET request is served by the SPA.
	static, err := fs.Sub(staticFiles, "static")
	if err != nil {
		panic(err)
	}
	r.Get("/*", SPAHandler(static))

	http.ListenAndServe(":3333", r)
}

// SPAHandler serves files from fsys. When the requested path is not an
// existing file, it serves index.html instead, so that client side routes
// keep working after a page reload.
func SPAHandler(fsys fs.FS) http.HandlerFunc {
	fileServer := http.FileServerFS(fsys)

	return func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" {
			name = "."
		}

		// Fall back to index.html for unknown paths and for directories, which
		// would otherwise be rendered as a directory listing.
		if info, err := fs.Stat(fsys, name); err != nil || (info.IsDir() && name != ".") {
			r.URL.Path = "/"
		}

		fileServer.ServeHTTP(w, r)
	}
}
