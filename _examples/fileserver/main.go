// FileServer
// ===========
// This example demonstrates how to serve static files from your filesystem.
//
// Boot the server:
// ----------------
// $ go run main.go
//
// Client requests:
// ----------------
// $ curl http://localhost:3333/files/
// <pre>
// <a href="notes.txt">notes.txt</a>
// </pre>
//
// $ curl http://localhost:3333/files/notes.txt
// Notessszzz
package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func main() {
	r := chi.NewRouter()
	r.Use(middleware.Logger)

	// Index handler
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hi"))
	})

	// Create a route along /files that will serve contents from
	// the ./data/ folder.
	r.Handle("/files/*", http.StripPrefix("/files/", http.FileServer(http.Dir("./data"))))
	http.ListenAndServe(":3333", r)
}
